import 'server-only'
import { controlPlanePool, clearTenantCache } from '@/lib/tenant-registry'
import { creditWallet, debitWallet, getWalletBalance } from '@/lib/payments/wallet'
import { domainProviders, domainPurchaseEnabled, RegistrarError, type Availability, type DomainContact } from './providers'
import { getDomainPricing, quoteTld, tldOf, tldPrices, type DomainQuote } from './pricing'
import { notifyDomain } from './notify'

// A bought domain is one tenant_domain_orders row that is also its job. Each advance moves it as far as it
// can go now, under a session advisory lock (the cron and the owner's page both advance), and saves after
// every external call so a crash never loses an operation id:
//   requested   (charge)   wallet debit; waits for an approved store and enough balance
//   registering (register) RegisterDomain once, then GetOperationDetail until SUCCESSFUL; ERROR/FAILED → refund
//   configuring (zone → records → routing → certs)  hosted zone, A records to the cluster, custom-domain rows
//                          for every host the plan gives the store (apex, www., admin., invoice., …) + the
//                          store's routes, cert-manager certificates
//   active                 serving; a plan change re-runs records → certs for the new host set; renewal.ts renews

export type OrderStatus = 'requested' | 'registering' | 'configuring' | 'active' | 'failed' | 'cancelled' | 'expired'
export const IN_FLIGHT: OrderStatus[] = ['requested', 'registering', 'configuring']

export interface OrderEvent {
  at: string
  step: string
  message: string
  level?: 'info' | 'warn' | 'error'
}

export interface DomainOrder {
  id: string
  tenant_id: string
  domain: string
  status: OrderStatus
  step: string | null
  source: 'dashboard' | 'onboarding'
  contact: DomainContact
  cost_usd: number
  renewal_cost_usd: number | null
  usd_inr: number
  margin: number
  price_inr: number
  charge_ref: string | null
  refunded_inr: number | null
  operation_id: string | null
  hosted_zone_id: string | null
  auto_renew: boolean
  contact_verified: boolean
  registered_at: string | null
  expires_at: string | null
  attempts: number
  next_at: string | null
  last_error: string | null
  events: OrderEvent[]
  created_at: string
  updated_at: string
}

const MAX_ATTEMPTS = 8
const pool = () => controlPlanePool()

/**
 * Every host the store's plan gives it, on the bought domain: {slug}.<root> → the apex and www., <app>-{slug} →
 * <app>.<domain>, {slug}.business → business.<domain>. Follows tenantHostnames, so a plan change adds or drops hosts.
 */
export async function boughtHosts(domain: string, slug: string, plan: string | null): Promise<string[]> {
  const { tenantHostnames } = await import('@controller/lib/provisioning/steps')
  const out: string[] = []
  for (const h of tenantHostnames(slug, plan)) {
    if (h.startsWith(`${slug}.business.`)) out.push(`business.${domain}`)
    else if (h.startsWith(`${slug}.`)) out.push(domain, `www.${domain}`)
    else {
      const app = h.match(/^([a-z]+)-/)?.[1]
      if (app && h.startsWith(`${app}-${slug}.`) && app !== 'public') out.push(`${app}.${domain}`)
    }
  }
  return [...new Set(out)]
}
const pollMs = (live: boolean) => (live ? 60_000 : 5_000)

function row(r: any): DomainOrder {
  return {
    ...r,
    cost_usd: Number(r.cost_usd),
    renewal_cost_usd: r.renewal_cost_usd == null ? null : Number(r.renewal_cost_usd),
    usd_inr: Number(r.usd_inr),
    margin: Number(r.margin),
    registered_at: r.registered_at ? new Date(r.registered_at).toISOString() : null,
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    next_at: r.next_at ? new Date(r.next_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  }
}

export async function getOrder(id: string): Promise<DomainOrder | null> {
  const r = await pool().query(`SELECT * FROM tenant_domain_orders WHERE id = $1`, [id])
  return r.rows[0] ? row(r.rows[0]) : null
}

export async function listOrders(tenantId: string): Promise<DomainOrder[]> {
  const r = await pool().query(
    `SELECT * FROM tenant_domain_orders WHERE tenant_id = $1 AND NOT (status IN ('failed','cancelled') AND updated_at < now() - interval '30 days')
      ORDER BY created_at DESC`,
    [tenantId]
  )
  return r.rows.map(row)
}

const COLUMNS = new Set([
  'status', 'step', 'charge_ref', 'refunded_inr', 'operation_id', 'hosted_zone_id', 'auto_renew', 'contact_verified',
  'registered_at', 'expires_at', 'attempts', 'next_at', 'last_error',
])

type Patch = Partial<Record<string, unknown>> & { event?: Omit<OrderEvent, 'at'> }

/** Save columns and append an event (skipped when it repeats the last one, so waits don't flood the log). */
export async function patchOrder(id: string, patch: Patch): Promise<DomainOrder> {
  const { event, ...cols } = patch
  const keys = Object.keys(cols).filter(k => COLUMNS.has(k))
  const sets = keys.map((k, i) => `${k} = $${i + 2}`)
  const params: unknown[] = [id, ...keys.map(k => cols[k])]
  if (event) {
    params.push(JSON.stringify([{ ...event, at: new Date().toISOString() }]))
    const p = `$${params.length}::jsonb`
    sets.push(
      `events = CASE WHEN events->-1->>'message' = ${p}->0->>'message' THEN events
                     ELSE (CASE WHEN jsonb_array_length(events) >= 40 THEN events - 0 ELSE events END) || ${p} END`
    )
  }
  sets.push('updated_at = now()')
  const r = await pool().query(`UPDATE tenant_domain_orders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)
  return row(r.rows[0])
}

/** One worker at a time per key; the lock is the session's, so a crash releases it. Null when held elsewhere. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool().connect()
  let locked = false
  try {
    locked = !!(await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key])).rows[0]?.ok
    if (!locked) return null
    return await fn()
  } finally {
    if (locked) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]).catch(() => {})
    client.release()
  }
}

// ── Search & quote ─────────────────────────────────────────────────────────────

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Lowercased host without scheme, path or a leading www. */
export function cleanDomain(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
}

export interface SearchResult {
  domain: string
  available: boolean
  availability: Availability | 'TAKEN_HERE'
  priceInr: number
  renewalPriceInr: number
}

async function liveOrderDomains(domains: string[]): Promise<Set<string>> {
  if (!domains.length) return new Set()
  const r = await pool().query(
    `SELECT domain FROM tenant_domain_orders WHERE domain = ANY($1::text[]) AND status NOT IN ('failed','cancelled','expired')
     UNION SELECT domain FROM tenant_custom_domains WHERE domain = ANY($1::text[]) AND status = 'verified'`,
    [domains]
  )
  return new Set(r.rows.map(x => x.domain))
}

async function offeredTlds(): Promise<string[]> {
  const [settings, prices] = await Promise.all([getDomainPricing(), tldPrices()])
  return settings.tlds.filter(t => prices.has(t))
}

/** Availability and yearly price for the name across the TLDs we sell, plus the registrar's suggestions. */
export async function searchDomains(query: string): Promise<{ results: SearchResult[]; suggestions: SearchResult[]; error?: string }> {
  const q = cleanDomain(query)
  const offered = await offeredTlds()
  const exactTld = q.includes('.') ? tldOf(q, offered) : null
  const name = exactTld ? q.slice(0, -(exactTld.length + 1)) : q.split('.')[0]
  if (!LABEL_RE.test(name)) return { results: [], suggestions: [], error: 'Use letters, numbers and hyphens (not at the start or end), up to 63 characters.' }
  if (q.includes('.') && !exactTld) return { results: [], suggestions: [], error: `We can't register .${q.split('.').slice(1).join('.')} names. Try ${offered.slice(0, 4).map(t => '.' + t).join(', ')}.` }

  const candidates = [...new Set([...(exactTld ? [`${name}.${exactTld}`] : []), ...offered.map(t => `${name}.${t}`)])].slice(0, 8)
  const { registrar } = await domainProviders()
  const quotes = new Map<string, DomainQuote | null>()
  for (const t of offered) quotes.set(t, await quoteTld(t))

  // Route 53 Domains allows about five requests a second per account: check four at a time, retry a throttled one once.
  const availabilityOf = async (d: string): Promise<Availability> => {
    try {
      return await registrar.checkAvailability(d)
    } catch (e) {
      if (!(e instanceof RegistrarError && e.retryable)) return 'DONT_KNOW'
      await new Promise(res => setTimeout(res, 1200))
      return registrar.checkAvailability(d).catch((): Availability => 'DONT_KNOW')
    }
  }
  const check = async (d: string): Promise<SearchResult | null> => {
    const q2 = quotes.get(tldOf(d, offered) ?? '')
    if (!q2) return null
    const availability = await availabilityOf(d)
    return { domain: d, available: availability === 'AVAILABLE', availability, priceInr: q2.priceInr, renewalPriceInr: q2.renewalPriceInr }
  }
  const results: SearchResult[] = []
  for (let i = 0; i < candidates.length; i += 4) {
    if (i && registrar.live) await new Promise(res => setTimeout(res, 1000))
    results.push(...(await Promise.all(candidates.slice(i, i + 4).map(check))).filter((x): x is SearchResult => !!x))
  }
  const suggested = await registrar.suggestions(`${name}.${exactTld ?? offered[0] ?? 'com'}`, 10).catch(() => [])
  const suggestions = suggested
    .filter(s => s.availability === 'AVAILABLE' && !candidates.includes(s.domain) && tldOf(s.domain, offered) && LABEL_RE.test(s.domain.split('.')[0]))
    .slice(0, 6)
    .map(s => {
      const q2 = quotes.get(tldOf(s.domain, offered)!)!
      return { domain: s.domain, available: true, availability: s.availability, priceInr: q2.priceInr, renewalPriceInr: q2.renewalPriceInr }
    })
  const held = await liveOrderDomains([...results, ...suggestions].map(r => r.domain))
  const mark = (r: SearchResult): SearchResult => (held.has(r.domain) ? { ...r, available: false, availability: 'TAKEN_HERE' } : r)
  return { results: results.map(mark), suggestions: suggestions.map(mark).filter(r => r.available) }
}

export type BuyResult =
  | { ok: true; order: DomainOrder }
  | { ok: false; code: 'disabled' | 'invalid' | 'unavailable' | 'price_changed' | 'wallet_short' | 'failed'; error: string; priceInr?: number; shortfallInr?: number; order?: DomainOrder }

/** Validate the name and re-price it now. */
async function freshQuote(raw: string): Promise<{ ok: true; domain: string; quote: DomainQuote } | { ok: false; code: 'invalid' | 'unavailable'; error: string }> {
  const domain = cleanDomain(raw)
  const offered = await offeredTlds()
  const tld = tldOf(domain, offered)
  if (!tld || !LABEL_RE.test(domain.slice(0, -(tld.length + 1)))) return { ok: false, code: 'invalid', error: 'Pick a domain from the search results.' }
  const { registrar } = await domainProviders()
  const availability = await registrar.checkAvailability(domain)
  if (availability !== 'AVAILABLE' || (await liveOrderDomains([domain])).size) return { ok: false, code: 'unavailable', error: `${domain} is no longer available.` }
  const quote = await quoteTld(tld)
  if (!quote) return { ok: false, code: 'invalid', error: `.${tld} names can't be bought right now.` }
  return { ok: true, domain, quote }
}

async function insertOrder(tenantId: string, domain: string, contact: DomainContact, quote: DomainQuote, source: 'dashboard' | 'onboarding', message: string) {
  try {
    const r = await pool().query(
      `INSERT INTO tenant_domain_orders (tenant_id, domain, status, step, source, contact, cost_usd, renewal_cost_usd, usd_inr, margin, price_inr, events)
       VALUES ($1, $2, 'requested', 'charge', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenantId, domain, source, JSON.stringify(contact), quote.costUsd, quote.renewalCostUsd, quote.usdInr, quote.margin, quote.priceInr,
        JSON.stringify([{ at: new Date().toISOString(), step: 'charge', message }])]
    )
    return row(r.rows[0])
  } catch (e: any) {
    if (e?.code === '23505') return null
    throw e
  }
}

/** Dashboard purchase: the owner confirmed `expectedPriceInr`; charge now and submit the registration. */
export async function buyDomain(input: { tenantId: string; domain: string; contact: DomainContact; expectedPriceInr: number }): Promise<BuyResult> {
  if (!domainPurchaseEnabled()) return { ok: false, code: 'disabled', error: 'Buying domains is not available yet.' }
  const q = await freshQuote(input.domain)
  if (!q.ok) return q
  if (q.quote.priceInr !== input.expectedPriceInr) {
    return { ok: false, code: 'price_changed', error: `The price changed to ₹${q.quote.priceInr.toLocaleString('en-IN')} a year. Confirm the new price to continue.`, priceInr: q.quote.priceInr }
  }
  const { balance } = await getWalletBalance(input.tenantId)
  if (balance < q.quote.priceInr) {
    const short = Math.ceil(q.quote.priceInr - balance)
    return { ok: false, code: 'wallet_short', error: `Your wallet has ₹${balance.toLocaleString('en-IN')}. Top up ₹${short.toLocaleString('en-IN')} to buy ${q.domain}.`, shortfallInr: short }
  }
  const order = await insertOrder(input.tenantId, q.domain, input.contact, q.quote, 'dashboard', `You confirmed ${q.domain} for ₹${q.quote.priceInr.toLocaleString('en-IN')} a year`)
  if (!order) return { ok: false, code: 'unavailable', error: `${q.domain} is no longer available.` }
  const after = (await advanceOrder(order.id, { force: true })) ?? order
  if (after.status === 'failed' || after.status === 'cancelled') return { ok: false, code: 'failed', error: after.last_error ?? 'The domain could not be bought.', order: after }
  return { ok: true, order: after }
}

/** Onboarding: the owner chose a domain; it is bought from the wallet once the store is approved. */
export async function requestDomain(input: { tenantId: string; domain: string; contact: DomainContact }): Promise<BuyResult> {
  if (!domainPurchaseEnabled()) return { ok: false, code: 'disabled', error: 'Buying domains is not available yet.' }
  const q = await freshQuote(input.domain)
  if (!q.ok) return q
  const order = await insertOrder(input.tenantId, q.domain, input.contact, q.quote, 'onboarding', `Chosen at onboarding: bought from your wallet once your store is approved`)
  if (!order) return { ok: false, code: 'unavailable', error: `${q.domain} is no longer available.` }
  return { ok: true, order }
}

export async function cancelOrder(id: string): Promise<DomainOrder | null> {
  return withLock(`domain_order:${id}`, async () => {
    const o = await getOrder(id)
    if (!o || o.status !== 'requested') return o
    return patchOrder(id, { status: 'cancelled', step: null, next_at: null, event: { step: 'charge', message: 'Cancelled by you; nothing was charged' } })
  })
}

export async function setOrderAutoRenew(id: string, on: boolean): Promise<DomainOrder> {
  const o = await patchOrder(id, { auto_renew: on, event: { step: 'renewal', message: on ? 'Auto-renew turned on' : 'Auto-renew turned off' } })
  const { syncRenewalWithAutoRenew } = await import('./renewal')
  await syncRenewalWithAutoRenew(o)
  return o
}

// ── The job ────────────────────────────────────────────────────────────────────

async function tenantState(tenantId: string): Promise<{ slug: string; status: string; plan: string | null } | null> {
  const r = await pool().query(`SELECT t.slug, t.status, p.slug AS plan FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`, [tenantId])
  return r.rows[0] ?? null
}

const orderHosts = async (id: string): Promise<string[]> =>
  (await pool().query(`SELECT domain FROM tenant_custom_domains WHERE order_id = $1 ORDER BY created_at`, [id])).rows.map(r => r.domain)

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const retryable = (e: unknown) => !(e instanceof RegistrarError) || e.retryable

async function failAndRefund(o: DomainOrder, reason: string): Promise<DomainOrder> {
  let refunded = 0
  if (o.charge_ref) {
    const r = await creditWallet({
      tenantId: o.tenant_id,
      amountInr: o.price_inr,
      category: 'domain',
      externalRef: `domain_refund:${o.id}`,
      note: `Refund: ${o.domain} could not be registered`,
    })
    if (!r.ok) throw new Error(`refund failed: ${r.error}`)
    refunded = o.price_inr
  }
  const out = await patchOrder(o.id, {
    status: 'failed',
    step: null,
    next_at: null,
    last_error: reason,
    refunded_inr: refunded || null,
    event: { step: o.step ?? 'register', message: refunded ? `Failed: ${reason}. ₹${refunded.toLocaleString('en-IN')} refunded to your wallet` : `Failed: ${reason}`, level: 'error' },
  })
  await notifyDomain(o.tenant_id, { kind: 'failed', domain: o.domain, reason, refundedInr: refunded })
  return out
}

/** A retryable error backs off; past MAX_ATTEMPTS the order fails (and is refunded). */
async function backoff(o: DomainOrder, e: unknown): Promise<DomainOrder> {
  const attempts = o.attempts + 1
  if (!retryable(e) || attempts >= MAX_ATTEMPTS) return failAndRefund(o, errText(e))
  return patchOrder(o.id, { attempts, last_error: errText(e), next_at: new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 3600_000)) })
}

const wait = (o: DomainOrder, ms: number, event?: Patch['event']) => patchOrder(o.id, { next_at: new Date(Date.now() + ms), ...(event ? { event } : {}) })

/** One step. Returns the saved order and whether to keep going in this call. */
async function step(o: DomainOrder): Promise<{ order: DomainOrder; more: boolean }> {
  const { registrar, dns, hosting } = await domainProviders()
  const live = registrar.live
  const done = (order: DomainOrder) => ({ order, more: true })
  const stop = (order: DomainOrder) => ({ order, more: false })

  if (o.status === 'requested') {
    const t = await tenantState(o.tenant_id)
    if (!t || !['active', 'provisioning'].includes(t.status)) return stop(await wait(o, 10 * 60_000, { step: 'charge', message: 'Waiting for your store to be approved' }))
    const availability = await registrar.checkAvailability(o.domain).catch((): Availability => 'DONT_KNOW')
    if (availability === 'DONT_KNOW') return stop(await wait(o, 5 * 60_000))
    if (availability !== 'AVAILABLE') {
      const reason = `${o.domain} is no longer available.`
      const out = await patchOrder(o.id, { status: 'cancelled', step: null, next_at: null, last_error: reason, event: { step: 'charge', message: `${reason} Nothing was charged`, level: 'warn' } })
      await notifyDomain(o.tenant_id, { kind: 'cancelled', domain: o.domain, reason })
      return stop(out)
    }
    const ref = `domain:${o.id}`
    const res = await debitWallet({ tenantId: o.tenant_id, amountInr: o.price_inr, category: 'domain', externalRef: ref, note: `Domain ${o.domain}, first year`, floorInr: 0 })
    if (!res.ok) {
      const { balance } = await getWalletBalance(o.tenant_id)
      const message = `Waiting for wallet balance: ₹${o.price_inr.toLocaleString('en-IN')} needed, ₹${balance.toLocaleString('en-IN')} available`
      if (!o.last_error?.startsWith('Waiting for wallet balance')) await notifyDomain(o.tenant_id, { kind: 'wallet_short', domain: o.domain, priceInr: o.price_inr, balanceInr: balance })
      return stop(await patchOrder(o.id, { last_error: message, next_at: new Date(Date.now() + 30 * 60_000), event: { step: 'charge', message, level: 'warn' } }))
    }
    return done(await patchOrder(o.id, {
      status: 'registering', step: 'register', charge_ref: ref, attempts: 0, last_error: null, next_at: null,
      event: { step: 'charge', message: `₹${o.price_inr.toLocaleString('en-IN')} charged to your wallet` },
    }))
  }

  if (o.status === 'registering') {
    if (!o.operation_id) {
      try {
        // A retry may follow a RegisterDomain whose id was never saved: look for it before submitting again.
        const found = o.attempts > 0 ? await registrar.findOperation(o.domain, 'REGISTER_DOMAIN') : null
        if (found) return done(await patchOrder(o.id, { operation_id: found.operationId, event: { step: 'register', message: 'Registration found at the registry' } }))
        await patchOrder(o.id, { attempts: o.attempts + 1 })
        const { operationId } = await registrar.register(o.domain, o.contact)
        return stop(await patchOrder(o.id, {
          operation_id: operationId, attempts: 0, last_error: null, next_at: new Date(Date.now() + pollMs(live)),
          event: { step: 'register', message: 'Registration submitted to the registry' },
        }))
      } catch (e) {
        return stop(await backoff(o, e))
      }
    }
    try {
      const op = await registrar.operation(o.operation_id)
      if (op.status === 'SUBMITTED' || op.status === 'IN_PROGRESS') {
        return stop(await wait(o, pollMs(live), { step: 'register', message: op.status === 'SUBMITTED' ? 'Waiting for the registry' : 'The registry is processing the registration' }))
      }
      if (op.status !== 'SUCCESSFUL') return stop(await failAndRefund(o, op.message || `registration ${op.status.toLowerCase()}`))
      const detail = await registrar.domainDetail(o.domain).catch(() => null)
      const expires = detail?.expiresAt ?? new Date(Date.now() + 365 * 86400_000)
      return done(await patchOrder(o.id, {
        status: 'configuring', step: 'zone', registered_at: new Date(), expires_at: expires, attempts: 0, last_error: null, next_at: null,
        event: { step: 'register', message: `Registered until ${expires.toISOString().slice(0, 10)}` },
      }))
    } catch (e) {
      return stop(await backoff(o, e))
    }
  }

  if (o.status === 'configuring') {
    // Registered and paid: hosting problems retry (and show in the admin view), they never refund.
    const later = async (e: unknown) => stop(await patchOrder(o.id, { attempts: o.attempts + 1, last_error: errText(e), next_at: new Date(Date.now() + Math.min(60_000 * 2 ** Math.min(o.attempts + 1, 6), 3600_000)) }))
    try {
      if (o.step === 'zone') {
        const zone = await dns.hostedZoneFor(o.domain)
        if (!zone) return stop(await wait(o, 2 * 60_000, { step: 'zone', message: 'Waiting for the DNS zone' }))
        return done(await patchOrder(o.id, { hosted_zone_id: zone, step: 'records', attempts: 0, last_error: null }))
      }
      if (o.step === 'records') {
        const t = await tenantState(o.tenant_id)
        if (!t) throw new Error('store not found')
        const hosts = await boughtHosts(o.domain, t.slug, t.plan)
        await dns.pointAtCluster(o.hosted_zone_id!, hosts)
        return done(await patchOrder(o.id, { step: 'routing', attempts: 0, last_error: null, event: { step: 'records', message: `${hosts.length} addresses on ${o.domain} point at your store` } }))
      }
      if (o.step === 'routing') {
        const t = await tenantState(o.tenant_id)
        if (t?.status !== 'active') return stop(await wait(o, 10 * 60_000, { step: 'routing', message: 'Waiting for your store to go live' }))
        const stale = await claimHosts(o, await boughtHosts(o.domain, t.slug, t.plan))
        await hosting.applyRoutes(o.tenant_id)
        for (const other of stale) await hosting.applyRoutes(other).catch(() => {})
        return done(await patchOrder(o.id, { step: 'certs', attempts: 0, last_error: null, event: { step: 'routing', message: 'Issuing security certificates' } }))
      }
      if (o.step === 'certs') {
        const t = await tenantState(o.tenant_id)
        const rows = (await pool().query(`SELECT id, domain, status, updated_at FROM tenant_custom_domains WHERE order_id = $1`, [o.id])).rows
        let pending = 0
        for (const r of rows) {
          if (r.status === 'verified') continue
          if (t && (await hosting.certReady(t.slug, r.domain, new Date(r.updated_at)))) {
            await pool().query(`UPDATE tenant_custom_domains SET status = 'verified', verified_at = now(), updated_at = now() WHERE id = $1`, [r.id])
          } else pending++
        }
        if (pending || !rows.length) {
          const since = rows.length ? Math.min(...rows.map(r => new Date(r.updated_at).getTime())) : Date.now()
          const slow = Date.now() - since > 48 * 3600_000
          return stop(await patchOrder(o.id, { next_at: new Date(Date.now() + (slow ? 30 * 60_000 : live ? 60_000 : 5_000)), ...(slow ? { last_error: 'Certificates not issued after 48 hours' } : {}) }))
        }
        clearTenantCache()
        await hosting.applyRoutes(o.tenant_id)
        // A plan-change resync comes back here too; only the first activation is news to the owner.
        const firstLive = !o.events.some(e => e.step === 'certs' && e.message.startsWith('Live'))
        const tld = tldOf(o.domain, (await tldPrices()).keys())
        const renewalPriceInr = tld ? ((await quoteTld(tld))?.renewalPriceInr ?? null) : null
        const out = await patchOrder(o.id, {
          status: 'active', step: null, attempts: 0, last_error: null, next_at: new Date(Date.now() + (live ? 6 * 3600_000 : 60_000)),
          event: { step: 'certs', message: `Live on ${rows.length} addresses at ${o.domain}` },
        })
        if (firstLive) await notifyDomain(o.tenant_id, { kind: 'active', domain: o.domain, hosts: rows.map(r => r.domain as string), expiresAt: o.expires_at, renewalPriceInr, autoRenew: o.auto_renew, email: o.contact.email })
        return stop(out)
      }
    } catch (e) {
      return later(e)
    }
  }

  if (o.status === 'active') {
    // The plan changed (business. on Pro, quotation. on Grow, …): bring the domain's hosts in line.
    const t = await tenantState(o.tenant_id)
    if (t?.status === 'active') {
      const want = await boughtHosts(o.domain, t.slug, t.plan)
      const have = await orderHosts(o.id)
      if (want.length !== have.length || want.some(h => !have.includes(h))) {
        return done(await patchOrder(o.id, { status: 'configuring', step: 'records', attempts: 0, event: { step: 'records', message: 'Your plan changed: updating the addresses on your domain' } }))
      }
    }
    if (!o.contact_verified) {
      const ok = await registrar.contactVerified(o.domain).catch(() => false)
      if (ok) return stop(await patchOrder(o.id, { contact_verified: true, next_at: new Date(Date.now() + 30 * 60_000), event: { step: 'contact', message: 'Contact email confirmed with the registry' } }))
    }
    return stop(await patchOrder(o.id, { next_at: new Date(Date.now() + (o.contact_verified ? 30 * 60_000 : 6 * 3600_000)) }))
  }
  return stop(o)
}

/**
 * Point the domain's hosts at this store: drop other stores' claims on them (we hold the registration now) and
 * hosts the plan no longer has, and upsert the rest as cert-pending. Returns the stores whose routes changed.
 */
async function claimHosts(o: DomainOrder, hosts: string[]): Promise<string[]> {
  const client = await pool().connect()
  try {
    await client.query('BEGIN')
    const gone = await client.query(
      `DELETE FROM tenant_custom_domains WHERE (domain = ANY($1::text[]) AND order_id IS DISTINCT FROM $2) OR (order_id = $2 AND NOT domain = ANY($1::text[])) RETURNING tenant_id, status`,
      [hosts, o.id]
    )
    for (const [i, h] of hosts.entries()) {
      // Created in this order so the apex is the store's first (canonical) custom domain.
      await client.query(
        `INSERT INTO tenant_custom_domains (tenant_id, domain, status, order_id, created_at)
         VALUES ($1, $2, 'cert-pending', $3, now() + make_interval(secs => $4))
         ON CONFLICT (domain) DO UPDATE SET order_id = EXCLUDED.order_id, tenant_id = EXCLUDED.tenant_id,
           status = CASE WHEN tenant_custom_domains.status = 'verified' THEN 'verified' ELSE 'cert-pending' END, updated_at = now()`,
        [o.tenant_id, h, o.id, i * 0.001]
      )
    }
    await client.query('COMMIT')
    clearTenantCache()
    return [...new Set(gone.rows.filter(r => r.tenant_id !== o.tenant_id && ['cert-pending', 'verified'].includes(r.status)).map(r => r.tenant_id as string))]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/**
 * Advance an order as far as it can go now. Respects next_at (backoff and polling) unless forced; returns
 * null when another worker holds it.
 */
export async function advanceOrder(id: string, opts: { force?: boolean } = {}): Promise<DomainOrder | null> {
  return withLock(`domain_order:${id}`, async () => {
    let o = await getOrder(id)
    if (!o) return null
    if (!opts.force && o.next_at && new Date(o.next_at).getTime() > Date.now()) return o
    for (let i = 0; i < 8; i++) {
      const before = o.status + o.step
      const r = await step(o)
      o = r.order
      if (!r.more || o.status + o.step === before) break
    }
    return o
  })
}

/** Stop serving a domain that expired: its hosts leave the store's routes. */
export async function expireOrder(o: DomainOrder): Promise<void> {
  await pool().query(`UPDATE tenant_custom_domains SET status = 'expired', updated_at = now() WHERE order_id = $1`, [o.id])
  clearTenantCache()
  await patchOrder(o.id, { status: 'expired', step: null, next_at: null, event: { step: 'renewal', message: 'Expired; the domain no longer points at your store', level: 'warn' } })
  const { hosting } = await domainProviders()
  await hosting.applyRoutes(o.tenant_id).catch(e => console.warn('[domains] routes not pruned', o.domain, errText(e)))
  await notifyDomain(o.tenant_id, { kind: 'expired', domain: o.domain })
}

/** The 5-minute job: every in-flight order that is due, then the renewals waiting on the registry. */
export async function runDomainOrdersCron(): Promise<{ advanced: number; errors: { id: string; error: string }[] }> {
  const due = await pool().query(
    `SELECT id FROM tenant_domain_orders
      WHERE status IN ('requested','registering','configuring','active') AND (next_at IS NULL OR next_at <= now())
      ORDER BY created_at LIMIT 200`
  )
  const errors: { id: string; error: string }[] = []
  let advanced = 0
  for (const { id } of due.rows) {
    try {
      if (await advanceOrder(id)) advanced++
    } catch (e) {
      errors.push({ id, error: errText(e) })
    }
  }
  const { advanceDueRenewals } = await import('./renewal')
  const renewals = await advanceDueRenewals({ only: 'renewing' })
  return { advanced, errors: [...errors, ...renewals.errors] }
}
