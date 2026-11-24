import 'server-only'
import { controlPlanePool, getOwnerById, getOwnerTenants } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { sendShowcaseEmail } from '@/lib/shared/ecom-emails'
import { isFlagshipTenant } from '@/lib/payments/wallet'
import { getShowcaseById, resumeShowcase, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'
import { showcaseHost } from '@/lib/showcase/host'
import { SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import { getOpenLine, type BillingLine } from '@controller/lib/billing/lines'
import { addLine, type ChangeResult } from '@controller/lib/billing/subscription'

// Showcase hosting: free for SHOWCASE_TRIAL_DAYS from the first publish, then a showcase_site line (₹200/month) on the
// workspace's subscription. The billing handler (lib/billing/webhook.ts) extends paid_until on each charge and brings
// a site paused for non-payment back; the billing sweep pauses a site whose trial ended unpaid (no grace, decision 2)
// or whose halted subscription's grace ran out.

export const SHOWCASE_REMIND_DAYS = 2
const DAY_MS = 86_400_000

const CONSOLE = `https://ecom.${ROOT_DOMAIN}/dashboard`
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

/** The workspace whose subscription pays: the site's own, else the owner's active one. */
export async function showcaseWalletTenant(site: Pick<ShowcaseSiteRow, 'tenantId' | 'ownerId'>): Promise<string | null> {
  if (site.tenantId) return site.tenantId
  const tenants = await getOwnerTenants(site.ownerId).catch(() => [])
  return tenants.find(t => t.status === 'active')?.id ?? null
}

export interface ShowcaseBilling {
  priceInr: number
  /** Still in the free trial that started with the first publish. */
  free: boolean
  /** Paid time has ended. */
  lapsed: boolean
  /** Keeping it online needs the owner: the trial ends within SHOWCASE_REMIND_DAYS, or it has lapsed, unpaid. */
  due: boolean
  /** A live site goes offline on this day unless it is paid. */
  pausesOn: string | null
  trialEndsAt: string | null
  /** Its billing line: trial, awaiting_payment, active, ending, legacy_wallet; null when none. */
  lineStatus: BillingLine['status'] | null
  /** On a subscription that will charge for it (autopay set up). */
  onSubscription: boolean
}

export function showcaseBilling(site: ShowcaseSiteRow, line: BillingLine | null = null, now = Date.now()): ShowcaseBilling {
  const paid = site.paidUntil ? Date.parse(site.paidUntil) : null
  const trialEnd = site.trialEndsAt ? Date.parse(site.trialEndsAt) : null
  const lapsed = paid !== null && paid <= now
  const covered = !!line && (line.status === 'active' || ((line.status === 'trial' || line.status === 'awaiting_payment') && !!line.subscriptionId))
  const free = trialEnd !== null && trialEnd > now && (line?.status ?? 'trial') === 'trial'
  const pausesOn =
    site.status !== 'live' || covered
      ? null
      : line?.status === 'legacy_wallet' || line?.graceUntil
        ? (line.graceUntil ?? null)
        : free
          ? new Date(trialEnd!).toISOString()
          : null
  return {
    priceInr: SHOWCASE_PRICE_INR,
    free,
    lapsed,
    due: site.status !== 'draft' && !covered && (lapsed || (paid !== null && paid - now <= SHOWCASE_REMIND_DAYS * DAY_MS) || line?.status === 'legacy_wallet'),
    pausesOn,
    trialEndsAt: site.trialEndsAt,
    lineStatus: line?.status ?? null,
    onSubscription: covered,
  }
}

export async function showcaseLine(site: Pick<ShowcaseSiteRow, 'id' | 'tenantId'>): Promise<BillingLine | null> {
  return site.tenantId ? getOpenLine(site.tenantId, 'showcase_site', site.id).catch(() => null) : null
}

export type ShowcaseCharge =
  | { ok: true; charged: boolean; resumed: boolean; site: ShowcaseSiteRow }
  /** `checkout`: the owner approves the subscription at checkoutUrl; `no_wallet`: no workspace to bill. */
  | { ok: false; code: 'not_found' | 'draft' | 'not_due' | 'no_page' | 'no_wallet' | 'wallet' | 'checkout'; error: string; site: ShowcaseSiteRow | null; checkoutUrl?: string }

const FREE_MONTH_SQL = `UPDATE showcase_sites
    SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + interval '1 month',
        status = CASE WHEN status = 'paused' AND pause_reason = 'unpaid' THEN 'live' ELSE status END,
        pause_reason = CASE WHEN status = 'paused' AND pause_reason = 'unpaid' THEN NULL ELSE pause_reason END,
        updated_at = now()
  WHERE id = $1`

async function payer(site: ShowcaseSiteRow) {
  const owner = await getOwnerById(site.ownerId)
  return { email: owner?.email ?? '', name: owner?.name ?? null }
}

/** Put the site on the workspace's subscription (from its trial end while it lasts). */
export async function addShowcaseToSubscription(siteId: string): Promise<ShowcaseCharge> {
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.', site: null }
  if (site.status === 'draft' || !site.publishedAt) return { ok: false, code: 'draft', error: 'Publish the site first: its trial is free.', site }
  if (site.workspaceSuspended) return { ok: false, code: 'no_wallet', error: 'This workspace is suspended. Please contact support.', site }
  const tenantId = site.tenantId ?? (await ensureShowcaseWorkspace(site).catch(() => null))
  if (!tenantId) return { ok: false, code: 'no_wallet', error: 'This site has no workspace to bill.', site }
  if (isFlagshipTenant(tenantId)) {
    // The platform's own sites are not billed: a month at a time, like before.
    await controlPlanePool().query(FREE_MONTH_SQL, [site.id])
    return { ok: true, charged: false, resumed: false, site: (await getShowcaseById(site.id)) ?? site }
  }
  const trial = site.trialEndsAt && Date.parse(site.trialEndsAt) > Date.now() ? site.trialEndsAt : null
  const r: ChangeResult = await addLine(tenantId, { kind: 'showcase_site', ref: site.id, trialEndsAt: trial }, await payer(site))
  const after = (await getShowcaseById(site.id)) ?? site
  if (r.status === 'checkout' || r.status === 'scheduled') {
    return { ok: false, code: 'checkout', error: `Approve ₹${SHOWCASE_PRICE_INR}/month on your subscription to keep ${showcaseHost(site.slug)} online.`, site: after, checkoutUrl: r.checkoutUrl ?? undefined }
  }
  return { ok: true, charged: false, resumed: false, site: after }
}

/** Pay now from the console: only while it is due (so a second click can't add it twice). */
export async function payShowcaseNow(siteId: string): Promise<ShowcaseCharge> {
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.', site: null }
  if (!showcaseBilling(site, await showcaseLine(site)).due) return { ok: false, code: 'not_due', error: `Nothing to pay yet: hosting is paid until ${day(site.paidUntil!)}.`, site }
  return addShowcaseToSubscription(siteId)
}

/** Back online from the console: free while hosting is paid, else it goes on the subscription first. */
export async function goLiveShowcase(siteId: string): Promise<ShowcaseCharge> {
  const first = await resumeShowcase(siteId)
  if (first.ok) return { ok: true, charged: false, resumed: true, site: first.site }
  if (first.code !== 'payment_due') return { ok: false, code: first.code, error: first.error, site: first.site ?? null }
  const added = await addShowcaseToSubscription(siteId)
  if (!added.ok) return added
  const live = await resumeShowcase(siteId)
  if (live.ok) return { ok: true, charged: false, resumed: true, site: live.site }
  return { ok: false, code: live.code === 'payment_due' ? 'checkout' : live.code, error: live.error, site: live.site ?? added.site }
}

/** "Your site is back online" after a charge brought a paused site back (lib/billing/webhook.ts). */
export async function notifyShowcaseResumed(siteId: string): Promise<void> {
  const site = await getShowcaseById(siteId)
  const owner = site && (await getOwnerById(site.ownerId))
  if (!site || !owner?.email) return
  const slug = site.tenantId
    ? ((await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [site.tenantId]).catch(() => null))?.rows[0]?.slug as string | undefined)
    : undefined
  await sendShowcaseEmail(
    { email: owner.email, name: owner.name },
    {
      subject: `${showcaseHost(site.slug)} is back online`,
      title: 'Your site is back online',
      lines: [`Thanks, the payment went through and <strong>${showcaseHost(site.slug)}</strong> is live again.`],
      rows: site.paidUntil ? [{ label: 'Paid until', value: day(site.paidUntil) }] : [],
      cta: { href: `${CONSOLE}/showcase${slug ? `?tenant=${encodeURIComponent(slug)}` : ''}`, label: 'Open your site settings' },
    }
  )
}
