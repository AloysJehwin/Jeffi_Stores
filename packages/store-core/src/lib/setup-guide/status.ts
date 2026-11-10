import { hasScope } from '@/lib/auth/scopes'
import { envGstApiCreds, type GstApiProvider } from '@/lib/shipping/gst-api-creds'
import {
  PLATFORM_ITEMS,
  SECTIONS,
  STEPS,
  type ApprovalStep,
  type GuideLink,
  type LiveValue,
  type OwnCredentials,
  type Permission,
  type PlatformItem,
  type RegisterItem,
  type SetupStep,
  type StepStatus,
} from './registry'
import { listPlatformProgress, listStoreProgress, mergeStatus, type ManualProgress } from './progress'
import { HOW_TO, type HowTo } from './how-to'
import { MESSAGING_LOCK_HINT, type MessagingLocks } from '@/lib/billing/messaging-locks'

// Step status from real state. Each resolver reads the facts it needs from a memoised context, so the
// resolvers run in parallel and share queries. Detected states are cached ~30 s per store; manual
// state is merged in fresh on every read.

export interface Detected {
  status: StepStatus
  detail?: string
}

type CredRow = { provider: string; status: string; meta: Record<string, any> | null }
type MarketChannel = 'myntra' | 'ajio'
type AlertChannel = 'gmc' | 'amazon' | 'amazon_ads' | 'meta_ads' | 'myntra' | 'ajio' | 'myntra_ads' | 'ajio_ads'

export interface StatusContext {
  tenantId: string | null
  now: Date
  settings(): Promise<Record<string, string>>
  credentials(): Promise<CredRow[]>
  kyc(): Promise<{ status: string; legals_accepted_version: string | null } | null>
  bank(): Promise<{ verification_status: string } | null>
  tenantRow(): Promise<{ razorpay_linked_account_id: string | null; own_razorpay: boolean } | null>
  razorpay(): Promise<{ kind: 'platform' | 'own' | 'route'; ownFlag: boolean; keysSet: boolean; lastWebhookAt: string | null }>
  shipping(): Promise<{ ok: boolean; mode?: string; error?: string }>
  pickupLocations(): Promise<number>
  codEnabled(): Promise<boolean>
  messagingLocks(): Promise<MessagingLocks>
  wallet(): Promise<{ balance: number; minBalance: number } | null>
  domains(): Promise<{ domain: string; status: string }[]>
  activeAdmins(): Promise<number>
  categories(): Promise<{ description: string | null }[]>
  brands(): Promise<number>
  products(): Promise<{ total: number; withImages: number }>
  heroSlides(): Promise<{ image_url: string | null; video_url: string | null }[]>
  gsheet(): Promise<{ state: string }>
  whatsappTemplates(): Promise<{ approved: number; total: number }>
  merchant(): Promise<{ connected: boolean; lastStatus: string | null }>
  amazon(): Promise<boolean>
  marketplace(c: MarketChannel): Promise<{ mode: string } | null>
  lastImport(c: 'myntra_ads' | 'ajio_ads'): Promise<string | null>
  googleAds(): Promise<{ connected: boolean; pendingAccount: boolean }>
  amazonAds(): Promise<{ profileId: string | null } | null>
  metaAds(): Promise<{ adAccountId: string | null; tokenExpiresAt: string | null; capi: boolean } | null>
  social(): Promise<{ network: string; status: string; tokenExpiry: string | null }[]>
  alerts(c: AlertChannel): Promise<{ severity: string; status: string; title: string }[]>
  serviceAccounts(): Promise<number>
  cliTokens(): Promise<number>
}

// Provisioning seeds a starter category (this description), products with no images and hero slides
// with no image (controller-service/src/lib/provisioning/seed.ts); none of those count as set up.
export const STARTER_CATEGORY_PREFIX = 'Starter category for '
export const isStarterCategory = (c: { description: string | null }) => !!c.description?.startsWith(STARTER_CATEGORY_PREFIX)

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const WHATSAPP_CORE_TEMPLATES = ['order/out-of-stock', 'order/payment-reminder', 'order/address-confirm']
const EXPIRY_WARN_DAYS = 7

const done = (detail?: string): Detected => ({ status: 'done', detail })
const todo = (detail?: string): Detected => ({ status: 'todo', detail })
const attention = (detail: string): Detected => ({ status: 'needs_attention', detail })
const waiting = (detail: string): Detected => ({ status: 'in_progress', detail })
const on = (v: string | undefined) => v === 'true'
const has = (v: string | undefined) => !!v && v.trim() !== ''
const missingList = (pairs: [string, boolean][]) => {
  const m = pairs.filter(([, ok]) => !ok).map(([k]) => k)
  return m.length ? `Missing: ${m.join(', ')}` : undefined
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

async function criticalAlert(ctx: StatusContext, c: AlertChannel): Promise<Detected | null> {
  const a = (await ctx.alerts(c)).find(x => x.status === 'open' && x.severity === 'critical')
  return a ? attention(a.title) : null
}

function expiryCheck(at: string | null, now: Date): Detected | null {
  if (!at) return null
  const days = (new Date(at).getTime() - now.getTime()) / 86_400_000
  if (days < 0) return attention('Access token expired. Reconnect.')
  if (days < EXPIRY_WARN_DAYS) return attention(`Access token expires ${fmtDate(at)}. Reconnect soon.`)
  return null
}

async function socialStep(ctx: StatusContext, networks: string[]): Promise<Detected> {
  const rows = (await ctx.social()).filter(r => networks.includes(r.network))
  const main = rows.find(r => r.network === networks[0])
  if (!main || main.status === 'not_connected') return todo()
  if (main.status === 'pending') return attention('Signed in. Choose where to post.')
  if (main.status !== 'connected') return attention(`Connection ${main.status}. Reconnect.`)
  const exp = expiryCheck(main.tokenExpiry, ctx.now)
  if (exp) return exp
  const extra = rows.filter(r => r.network !== networks[0] && r.status !== 'connected')
  return done(extra.length ? 'Instagram not connected' : undefined)
}

async function taxStep(ctx: StatusContext, provider: GstApiProvider): Promise<Detected> {
  if (!ctx.tenantId) return envGstApiCreds(provider) ? done('Platform keys') : todo()
  const row = (await ctx.credentials()).find(c => c.provider === provider)
  if (!row) return todo('Not available until you add your own API access')
  return row.status === 'connected' ? done() : attention(`Credentials ${row.status}. Re-enter them.`)
}

async function marketplaceStep(ctx: StatusContext, c: MarketChannel): Promise<Detected> {
  const creds = await ctx.marketplace(c)
  if (!creds) return todo()
  const alert = await criticalAlert(ctx, c)
  if (alert) return alert
  return creds.mode === 'live' ? done() : waiting(`Connected in ${creds.mode} mode; goes live after the first successful test call`)
}

async function adsImportStep(ctx: StatusContext, c: 'myntra_ads' | 'ajio_ads'): Promise<Detected> {
  const alert = await criticalAlert(ctx, c)
  if (alert) return alert
  const last = await ctx.lastImport(c)
  return last ? done(`Last report imported ${fmtDate(last)}`) : todo()
}

export const RESOLVERS: Record<string, (ctx: StatusContext) => Promise<Detected>> = {
  async 'store-identity'(ctx) {
    const s = await ctx.settings()
    const pairs: [string, boolean][] = [
      ['name', has(s.business_name)],
      ['email or phone', has(s.business_email) || has(s.business_phone)],
      ['logo', has(s.business_logo_url)],
    ]
    return pairs.every(([, ok]) => ok) ? done() : todo(missingList(pairs))
  },
  async 'legal-details'(ctx) {
    const s = await ctx.settings()
    const pairs: [string, boolean][] = [
      ['legal name', has(s.business_legal_name)],
      ['address', has(s.business_address)],
    ]
    if (ctx.tenantId) pairs.push(['accepted legal terms', !!(await ctx.kyc())?.legals_accepted_version])
    return pairs.every(([, ok]) => ok) ? done() : todo(missingList(pairs))
  },
  async gstin(ctx) {
    const s = await ctx.settings()
    const g = (s.business_gstin ?? '').trim().toUpperCase()
    if (!g) return todo()
    if (!GSTIN_RE.test(g)) return attention('The GSTIN does not look valid. Check it.')
    return on(s.feature_gst_enabled) ? done(g) : todo('GST is turned off in Payments & tax')
  },
  async 'invoice-setup'(ctx) {
    const s = await ctx.settings()
    const pairs: [string, boolean][] = [
      ['invoice prefix', has(s.invoice_prefix)],
      ['seal', has(s.business_seal_url)],
      ['bank account', has(s.bank_account) && has(s.bank_ifsc)],
    ]
    return pairs.every(([, ok]) => ok) ? done() : todo(missingList(pairs))
  },
  async 'custom-domain'(ctx) {
    const d = await ctx.domains()
    const verified = d.find(x => x.status === 'verified')
    if (verified) return done(verified.domain)
    const pending = d.find(x => x.status === 'pending' || x.status === 'cert-pending')
    if (pending) return waiting(`${pending.domain}: waiting for DNS and the certificate`)
    const failed = d.find(x => x.status === 'failed')
    return failed ? attention(`${failed.domain} failed verification`) : todo()
  },
  async team(ctx) {
    const n = await ctx.activeAdmins()
    return n > 1 ? done(`${n} admins`) : todo()
  },
  async 'google-tag'(ctx) {
    return has((await ctx.settings()).google_tag_id) ? done() : todo()
  },

  async razorpay(ctx) {
    const s = await ctx.settings()
    if (s.feature_razorpay_enabled === 'false') return todo('Online payments are turned off')
    const r = await ctx.razorpay()
    if (r.kind === 'route') {
      return r.ownFlag ? todo('Set to collect on your own account: add your Razorpay keys') : done('Paid through the platform Razorpay account')
    }
    if (r.kind === 'platform' && !r.keysSet) return attention('Razorpay keys are missing')
    return r.lastWebhookAt ? done(`Last webhook ${fmtDate(r.lastWebhookAt)}`) : attention('No webhook received yet. Check the webhook URL and secret.')
  },
  async 'kyc-bank'(ctx) {
    const [kyc, bank, t] = await Promise.all([ctx.kyc(), ctx.bank(), ctx.tenantRow()])
    if (!kyc) return todo('Submit KYC in the owner portal')
    if (kyc.status === 'rejected') return attention('KYC was rejected. See the reviewer note in the owner portal.')
    if (bank?.verification_status === 'failed') return attention('Bank account verification failed')
    if (kyc.status !== 'approved') return waiting('KYC under review')
    if (!bank) return todo('Add a payout bank account')
    if (bank.verification_status === 'pending') return waiting('Bank account being verified')
    if (t && !t.own_razorpay && !t.razorpay_linked_account_id) return waiting('Payout account being set up')
    return done()
  },
  async delhivery(ctx) {
    const sh = await ctx.shipping()
    if (!sh.ok) return attention(sh.error ?? 'Delivery account needs attention')
    const n = await ctx.pickupLocations()
    if (!n) return todo('Add a pickup location')
    return done(sh.mode === 'own' ? 'Your own Delhivery account' : sh.mode === 'platform' ? 'Platform Delhivery account' : undefined)
  },
  async cod(ctx) {
    return (await ctx.codEnabled()) ? done('On') : todo('Off: customers can only pay online')
  },
  async 'shipping-rates'(ctx) {
    const s = await ctx.settings()
    const set = ['delivery_charges_enabled', 'delivery_free_threshold', 'delivery_rate_per_kg'].some(k => has(s[k]))
    return set ? done() : todo('Using the default shipping charges')
  },
  async wallet(ctx) {
    const w = await ctx.wallet()
    if (!w) return todo('Top up your wallet')
    if (w.balance <= Math.max(0, w.minBalance)) return attention(`Balance ${inr(w.balance)}. Top up to keep shipping and messaging running.`)
    return done(`Balance ${inr(w.balance)}`)
  },

  async categories(ctx) {
    const rows = await ctx.categories()
    if (rows.some(c => !isStarterCategory(c))) return done()
    return todo(rows.length ? 'Only the starter category so far' : undefined)
  },
  async brands(ctx) {
    return (await ctx.brands()) > 0 ? done() : todo()
  },
  async products(ctx) {
    const p = await ctx.products()
    if (p.withImages > 0) return done(`${p.withImages} of ${p.total} products have images`)
    return todo(p.total ? 'No product has an image yet; the starter products are placeholders' : undefined)
  },
  async hero(ctx) {
    const rows = await ctx.heroSlides()
    if (rows.some(r => has(r.image_url ?? undefined) || has(r.video_url ?? undefined))) return done()
    return todo(rows.length ? 'No banner has an image yet' : undefined)
  },
  async 'google-sheets'(ctx) {
    const g = await ctx.gsheet()
    if (g.state === 'connected') return done()
    return g.state === 'needs_reconnect' ? attention('Google refused the saved sign-in. Reconnect.') : todo()
  },

  async email() {
    return done('Sent from your store address')
  },
  async sms(ctx) {
    const lock = (await ctx.messagingLocks()).sms
    if (lock) return lock === 'number' ? attention(MESSAGING_LOCK_HINT.number) : todo(MESSAGING_LOCK_HINT.addon)
    return on((await ctx.settings()).feature_sms_enabled) ? done() : todo()
  },
  async whatsapp(ctx) {
    const lock = (await ctx.messagingLocks()).whatsapp
    if (lock) return lock === 'number' ? attention(MESSAGING_LOCK_HINT.number) : todo(MESSAGING_LOCK_HINT.addon)
    if (!on((await ctx.settings()).feature_whatsapp_enabled)) return todo()
    const t = await ctx.whatsappTemplates()
    if (t.approved >= t.total) return done()
    return attention(t.approved ? `${t.approved} of ${t.total} key templates approved by Meta` : 'Templates not approved by Meta yet; messages go out as plain text')
  },
  async push(ctx) {
    return on((await ctx.settings()).feature_push_enabled) ? done() : todo()
  },

  async 'google-merchant'(ctx) {
    const m = await ctx.merchant()
    if (!m.connected) return todo()
    const alert = await criticalAlert(ctx, 'gmc')
    if (alert) return alert
    return m.lastStatus === 'error' ? attention('The last sync failed') : done()
  },
  async amazon(ctx) {
    if (!(await ctx.amazon())) return todo()
    return (await criticalAlert(ctx, 'amazon')) ?? done()
  },
  myntra: ctx => marketplaceStep(ctx, 'myntra'),
  ajio: ctx => marketplaceStep(ctx, 'ajio'),

  async 'google-ads'(ctx) {
    const g = await ctx.googleAds()
    if (g.connected) return done()
    return g.pendingAccount ? attention('Signed in. Choose the ads account.') : todo()
  },
  async 'amazon-ads'(ctx) {
    const cfg = await ctx.amazonAds()
    if (!cfg) return todo()
    if (!cfg.profileId) return attention('Signed in. Choose the advertising profile.')
    return (await criticalAlert(ctx, 'amazon_ads')) ?? done()
  },
  async 'meta-ads'(ctx) {
    const cfg = await ctx.metaAds()
    if (!cfg) return todo()
    if (!cfg.adAccountId) return attention('Signed in. Choose the ad account.')
    const exp = expiryCheck(cfg.tokenExpiresAt, ctx.now)
    if (exp) return exp
    const alert = await criticalAlert(ctx, 'meta_ads')
    if (alert) return alert
    return done(cfg.capi ? undefined : 'Conversions API not set up yet')
  },
  'myntra-ads': ctx => adsImportStep(ctx, 'myntra_ads'),
  'ajio-ads': ctx => adsImportStep(ctx, 'ajio_ads'),

  'facebook-instagram': ctx => socialStep(ctx, ['facebook', 'instagram']),
  gbp: ctx => socialStep(ctx, ['gbp']),
  youtube: ctx => socialStep(ctx, ['youtube']),
  pinterest: ctx => socialStep(ctx, ['pinterest']),
  linkedin: ctx => socialStep(ctx, ['linkedin']),
  x: ctx => socialStep(ctx, ['x']),

  ewaybill: ctx => taxStep(ctx, 'ewaybill'),
  einvoice: ctx => taxStep(ctx, 'einvoice'),

  async 'service-accounts'(ctx) {
    return (await ctx.serviceAccounts()) > 0 ? done() : todo()
  },
  async cli(ctx) {
    return (await ctx.cliTokens()) > 0 ? done() : todo()
  },
}

/** Run every resolver in parallel; one failing check never fails the page. */
export async function detectAll(ctx: StatusContext, steps: SetupStep[]): Promise<Record<string, Detected>> {
  const entries = await Promise.all(
    steps.map(async s => {
      const r = RESOLVERS[s.id]
      if (!r) return [s.id, todo()] as const
      try {
        return [s.id, await r(ctx)] as const
      } catch (e) {
        console.error(`[setup-guide] ${s.id} check failed`, e)
        return [s.id, todo('Could not check right now')] as const
      }
    })
  )
  return Object.fromEntries(entries)
}

// ── Live context ─────────────────────────────────────────────────────────

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null
  return () => (p ??= fn())
}
function memoBy<K extends string, T>(fn: (k: K) => Promise<T>): (k: K) => Promise<T> {
  const m = new Map<K, Promise<T>>()
  return k => {
    let p = m.get(k)
    if (!p) m.set(k, (p = fn(k)))
    return p
  }
}

export async function buildContext(tenantId: string | null): Promise<StatusContext> {
  const [{ queryMany, queryOne }, reg, { PLATFORM_TENANT_ID }] = await Promise.all([
    import('@/lib/shared/db'),
    import('@/lib/tenant-registry'),
    import('@/lib/import/jobs'),
  ])
  const credKey = tenantId ?? PLATFORM_TENANT_ID
  const num = (v: unknown) => Number(v ?? 0) || 0

  return {
    tenantId,
    now: new Date(),
    settings: memo(async () => {
      const rows = await queryMany<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings`)
      return Object.fromEntries(rows.map(r => [r.key, (r.value ?? '').trim()]))
    }),
    credentials: memo(async () => (await reg.listIntegrationCredentials(credKey)) as CredRow[]),
    kyc: memo(async () => {
      if (!tenantId) return null
      const r = await reg.controlPlanePool().query(`SELECT status, legals_accepted_version FROM tenant_kyc WHERE tenant_id = $1`, [tenantId])
      return r.rows[0] ?? null
    }),
    bank: memo(async () => (tenantId ? await reg.getTenantBankAccount(tenantId) : null)),
    tenantRow: memo(async () => {
      if (!tenantId) return null
      const r = await reg.controlPlanePool().query(`SELECT razorpay_linked_account_id, own_razorpay FROM tenants WHERE id = $1`, [tenantId])
      return r.rows[0] ?? null
    }),
    razorpay: memo(async () => {
      const [{ razorpayAccountFor }, { lastRazorpayWebhook }, { resolveRazorpayCreds }] = await Promise.all([
        import('@/lib/payments/rzp-account'),
        import('@/lib/payments/rzp-webhook-health'),
        import('@/lib/integrations/resolve'),
      ])
      const a = await razorpayAccountFor()
      const keysSet = a.kind === 'own' || (a.kind === 'platform' && !!(await resolveRazorpayCreds().catch(() => null))?.key_id)
      const lastWebhookAt = a.kind === 'route' ? null : await lastRazorpayWebhook(a.tenantId)
      return { kind: a.kind, ownFlag: a.ownFlag, keysSet, lastWebhookAt }
    }),
    shipping: memo(async () => {
      const { resolveShippingAccount } = await import('@/lib/shipping/delhivery-account')
      return resolveShippingAccount(tenantId)
    }),
    pickupLocations: memo(async () => {
      const r = await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM delhivery_pickup_locations
         WHERE COALESCE(tenant_id, $2::uuid) = COALESCE($1::uuid, $2::uuid) AND active = true`,
        [tenantId, PLATFORM_TENANT_ID]
      )
      return num(r?.n)
    }),
    codEnabled: memo(async () => {
      const { getFeatureFlags } = await import('@/lib/catalog/site-controls')
      return (await getFeatureFlags()).codEnabled
    }),
    messagingLocks: memo(async () => {
      const { getSiteControls } = await import('@/lib/catalog/site-controls')
      return (await getSiteControls()).locks ?? {}
    }),
    wallet: memo(async () => {
      if (!tenantId) return null
      const r = await reg.controlPlanePool().query(`SELECT balance, min_balance FROM tenant_wallets WHERE tenant_id = $1`, [tenantId])
      const row = r.rows[0]
      return row ? { balance: num(row.balance), minBalance: num(row.min_balance) } : null
    }),
    domains: memo(async () => (tenantId ? await reg.listCustomDomains(tenantId) : [])),
    activeAdmins: memo(async () => {
      const r = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM admins WHERE is_active = true AND role <> 'service_account'`)
      return num(r?.n)
    }),
    categories: memo(() =>
      queryMany<{ description: string | null }>(
        `SELECT description FROM categories WHERE is_active = true AND is_draft = false ORDER BY created_at LIMIT 5`
      )
    ),
    brands: memo(async () => {
      const r = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM brands WHERE is_active = true AND is_draft = false`)
      return num(r?.n)
    }),
    products: memo(async () => {
      const r = await queryOne<{ total: string; with_images: string }>(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)) AS with_images
         FROM products p WHERE p.is_active = true`
      )
      return { total: num(r?.total), withImages: num(r?.with_images) }
    }),
    heroSlides: memo(() =>
      queryMany<{ image_url: string | null; video_url: string | null }>(
        `SELECT image_url, video_url FROM hero_slides WHERE is_active = true LIMIT 20`
      )
    ),
    gsheet: memo(async () => {
      const { getGsheetStatus } = await import('@/lib/import/jobs')
      return getGsheetStatus(credKey)
    }),
    whatsappTemplates: memo(async () => {
      const { whatsappTemplateApproved } = await import('@/lib/messaging/library')
      const ok = await Promise.all(WHATSAPP_CORE_TEMPLATES.map(s => whatsappTemplateApproved(s).catch(() => false)))
      return { approved: ok.filter(Boolean).length, total: ok.length }
    }),
    merchant: memo(async () => {
      const [{ merchantConfigured }, { getLastSyncStatus }] = await Promise.all([import('@/lib/merchant/client'), import('@/lib/merchant/sync')])
      const connected = await merchantConfigured()
      const last = connected ? await getLastSyncStatus() : null
      return { connected, lastStatus: last?.status ?? null }
    }),
    amazon: memo(async () => {
      const { amazonConfigured } = await import('@/lib/amazon/client')
      return amazonConfigured()
    }),
    marketplace: memoBy(async (c: MarketChannel) => {
      const { resolveMarketplaceCreds } = await import('@/lib/integrations/resolve')
      const creds = await resolveMarketplaceCreds(c, credKey).catch(() => null)
      return creds ? { mode: creds.mode } : null
    }),
    lastImport: memoBy(async (c: 'myntra_ads' | 'ajio_ads') => {
      const r = await queryOne<{ at: string | null }>(
        `SELECT max(finished_at)::text AS at FROM channel_sync_log WHERE channel = $1 AND status IN ('success','partial')`,
        [c]
      ).catch(() => null)
      return r?.at ?? null
    }),
    googleAds: memo(async () => {
      const { getAdsConnectionStatus } = await import('@/lib/google-ads/connection')
      const s = await getAdsConnectionStatus(credKey)
      return { connected: s.connected, pendingAccount: s.pendingAccount }
    }),
    amazonAds: memo(async () => {
      const { readAmazonAdsConfig } = await import('@/lib/amazon-ads/client')
      const cfg = await readAmazonAdsConfig(credKey)
      return cfg ? { profileId: cfg.profile_id ?? null } : null
    }),
    metaAds: memo(async () => {
      const { readMetaAdsConfig } = await import('@/lib/meta-ads/client')
      const cfg = await readMetaAdsConfig(credKey)
      return cfg ? { adAccountId: cfg.ad_account_id ?? null, tokenExpiresAt: cfg.token_expires_at ?? null, capi: !!cfg.capi_token } : null
    }),
    social: memo(async () => {
      const { listConnections } = await import('@/lib/social/data')
      return (await listConnections(tenantId)).map(c => ({ network: c.network, status: c.status, tokenExpiry: c.tokenExpiry ?? null }))
    }),
    alerts: memoBy(async (c: AlertChannel) => {
      const { listChannelAlerts } = await import('@/lib/channels/alerts-engine')
      return listChannelAlerts(c)
    }),
    serviceAccounts: memo(async () => {
      const r = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM service_accounts WHERE is_revoked = false`)
      return num(r?.n)
    }),
    cliTokens: memo(async () => {
      const r = await reg.controlPlanePool().query(
        `SELECT count(*) AS n FROM admin_api_tokens WHERE tenant_id = $1 AND kind = 'cli' AND status = 'active' AND revoked_at IS NULL`,
        [credKey]
      )
      return num(r.rows[0]?.n)
    }),
  }
}

// ── Resolution for the API ───────────────────────────────────────────────

export interface ResolvedRegister {
  label: string
  value: string
  hint?: string
}
export interface ResolvedOwnCredentials {
  summary: string
  consoles: GuideLink[]
  create: string[]
  steps: string[]
  register: ResolvedRegister[]
  permissions: Permission[]
  approval: ApprovalStep[]
  paste: { fields: string[]; href: string; external: boolean; label: string }
  rejections: string[]
  notes: string[]
}
export interface ResolvedStep {
  id: string
  section: string
  title: string
  why: string
  href: string
  external: boolean
  connect: string | null
  optional: boolean
  canOpen: boolean
  status: StepStatus
  detected: StepStatus
  detail: string | null
  manual: ManualProgress | null
  ownCredentials: ResolvedOwnCredentials | null
  howTo: ResolvedHowTo | null
}
export interface ResolvedHowTo {
  before: string[]
  steps: string[]
  links: GuideLink[]
  wait: string | null
  notes: string[]
}
export interface StatusCounts {
  total: number
  done: number
  todo: number
  in_progress: number
  needs_attention: number
  skipped: number
}
export interface SetupGuideResult {
  sections: { id: string; title: string }[]
  steps: ResolvedStep[]
  counts: StatusCounts
}

interface Urls {
  store: string
  platform: string
  owner: string
  ownerSlug: string | null
  social: string
  oauth: (p: Extract<LiveValue, { kind: 'oauth' }>['provider']) => string
}

async function liveUrls(tenantId: string | null): Promise<Urls> {
  const [{ storeBaseUrlAsync, platformOAuthBaseUrl }, { oauthRedirectUri }, { socialRedirectUri }, { ROOT_DOMAIN }, { resolveTenant }] = await Promise.all([
    import('@/lib/catalog/brand'),
    import('@/lib/integrations/oauth'),
    import('@/lib/social/oauth'),
    import('@/lib/tenant-registry/shared'),
    import('@/lib/tenancy/tenant-context'),
  ])
  let store = await storeBaseUrlAsync()
  let slug: string | null = null
  if (tenantId) {
    const { listCustomDomains } = await import('@/lib/tenant-registry')
    const verified = (await listCustomDomains(tenantId).catch(() => [])).find(d => d.status === 'verified')
    if (verified) store = `https://${verified.domain}`
    slug = (await resolveTenant().catch(() => null))?.slug ?? null
  }
  const ownerBase = (process.env.NEXT_PUBLIC_ECOM_URL || `https://ecom.${ROOT_DOMAIN}`).replace(/\/$/, '')
  return {
    store: store.replace(/\/$/, ''),
    platform: platformOAuthBaseUrl(),
    owner: ownerBase,
    ownerSlug: slug,
    social: socialRedirectUri(),
    oauth: p => oauthRedirectUri(p),
  }
}

function liveValue(v: LiveValue, u: Urls): string {
  switch (v.kind) {
    case 'oauth':
      return u.oauth(v.provider)
    case 'social':
      return u.social
    case 'store':
      return `${u.store}${v.path}`
    case 'platform':
      return `${u.platform}${v.path}`
    case 'text':
      return v.value
  }
}

/** owner:/path → the owner portal (with the store picked); admin paths stay relative. */
export function resolveHref(href: string, u: Pick<Urls, 'owner' | 'ownerSlug'>): { href: string; external: boolean } {
  if (!href.startsWith('owner:')) return { href, external: /^https?:/.test(href) }
  const path = href.slice('owner:'.length)
  const pick = u.ownerSlug ? `${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(u.ownerSlug)}` : ''
  return { href: `${u.owner}${path}${pick}`, external: true }
}

const resolveRegister = (items: RegisterItem[] | undefined, u: Urls): ResolvedRegister[] =>
  (items ?? []).map(r => ({ label: r.label, value: liveValue(r.value, u), hint: r.hint }))

function resolveOwn(o: OwnCredentials | undefined, u: Urls): ResolvedOwnCredentials | null {
  if (!o) return null
  const paste = resolveHref(o.paste.href, u)
  return {
    summary: o.summary,
    consoles: o.consoles,
    create: o.create,
    steps: o.steps,
    register: resolveRegister(o.register, u),
    permissions: o.permissions ?? [],
    approval: o.approval ?? [],
    paste: { fields: o.paste.fields, href: paste.href, external: paste.external, label: o.paste.label },
    rejections: o.rejections ?? [],
    notes: o.notes ?? [],
  }
}

const resolveHowTo = (h: HowTo | undefined): ResolvedHowTo | null =>
  h ? { before: h.before ?? [], steps: h.steps, links: h.links ?? [], wait: h.wait ?? null, notes: h.notes ?? [] } : null

export function countStatuses(statuses: StepStatus[]): StatusCounts {
  const c: StatusCounts = { total: statuses.length, done: 0, todo: 0, in_progress: 0, needs_attention: 0, skipped: 0 }
  for (const s of statuses) c[s]++
  return c
}

/** Steps this store sees: plan sells the step's scope; tenant-only steps hidden on the flagship. */
export function visibleSteps(tenantId: string | null, planScopes: Set<string> | null): SetupStep[] {
  return STEPS.filter(s => {
    if (s.tenantOnly && !tenantId) return false
    const gate = s.planScope ?? s.scope
    return !gate || !planScopes || planScopes.has(gate)
  })
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; detected: Record<string, Detected> }>()

export function invalidateSetupGuideCache(tenantId?: string | null): void {
  if (tenantId === undefined) cache.clear()
  else cache.delete(tenantId ?? 'platform')
}

export async function getSetupGuide(admin: { role: string; scopes: string[] }, tenantId: string | null): Promise<SetupGuideResult> {
  let planScopes: Set<string> | null = null
  if (tenantId) {
    const { getTenantPlan } = await import('@/lib/auth/plan-gate')
    planScopes = (await getTenantPlan(tenantId)).scopes
  }
  const steps = visibleSteps(tenantId, planScopes)
  const key = tenantId ?? 'platform'
  let hit = cache.get(key)
  if (!hit || Date.now() - hit.at > TTL_MS) {
    hit = { at: Date.now(), detected: await detectAll(await buildContext(tenantId), steps) }
    cache.set(key, hit)
  }
  const detected = hit.detected
  const [manual, urls] = await Promise.all([listStoreProgress(), liveUrls(tenantId)])
  const resolved: ResolvedStep[] = steps.map(s => {
    const d = detected[s.id] ?? todo()
    const m = manual.get(s.id) ?? null
    const link = resolveHref(s.href, urls)
    return {
      id: s.id,
      section: s.section,
      title: s.title,
      why: s.why,
      href: link.href,
      external: link.external,
      connect: s.connect ?? null,
      optional: !!s.optional,
      canOpen: !s.scope || hasScope(admin.role, admin.scopes, s.scope),
      status: mergeStatus(d.status, m?.state),
      detected: d.status,
      detail: d.detail ?? null,
      manual: m,
      ownCredentials: resolveOwn(s.ownCredentials, urls),
      howTo: resolveHowTo(HOW_TO[s.id]),
    }
  })
  return {
    sections: SECTIONS.filter(sec => resolved.some(r => r.section === sec.id)),
    steps: resolved,
    counts: countStatuses(resolved.map(r => r.status)),
  }
}

// ── Platform apps ────────────────────────────────────────────────────────

export interface ResolvedPlatformItem {
  id: string
  title: string
  why: string
  status: StepStatus
  keys: { present: string[]; missing: string[] }
  manual: ManualProgress | null
  consoles: GuideLink[]
  steps: string[]
  register: ResolvedRegister[]
  approval: ApprovalStep[]
  rejections: string[]
}

/** Keys this admin-service process holds decide the base; the manual state tracks approvals. */
export function platformStatus(item: Pick<PlatformItem, 'env' | 'doneWhenKeys'>, manual: ManualProgress['state'] | null | undefined, env: Record<string, string | undefined> = process.env): StepStatus {
  const missing = item.env.filter(k => !env[k])
  if (missing.length) return manual === 'approved' ? 'needs_attention' : mergeStatus('todo', manual)
  if (item.doneWhenKeys && item.env.length) return 'done'
  return mergeStatus('todo', manual)
}

export async function getPlatformApps(): Promise<{ items: ResolvedPlatformItem[]; counts: StatusCounts }> {
  const [manual, urls] = await Promise.all([listPlatformProgress(), liveUrls(null)])
  const items = PLATFORM_ITEMS.map(i => {
    const m = manual.get(i.id) ?? null
    return {
      id: i.id,
      title: i.title,
      why: i.why,
      status: platformStatus(i, m?.state),
      keys: { present: i.env.filter(k => !!process.env[k]), missing: i.env.filter(k => !process.env[k]) },
      manual: m,
      consoles: i.consoles,
      steps: i.steps,
      register: resolveRegister(i.register, urls),
      approval: i.approval ?? [],
      rejections: i.rejections ?? [],
    }
  })
  return { items, counts: countStatuses(items.map(i => i.status)) }
}
