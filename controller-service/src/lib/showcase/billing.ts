import 'server-only'
import type { PoolClient } from 'pg'
import { controlPlanePool, getOwnerById, getOwnerTenants } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { debitWallet, getWalletBalance, isFlagshipTenant } from '@/lib/payments/wallet'
import { sendShowcaseEmail } from '@/lib/shared/ecom-emails'
import { getShowcaseById, pauseShowcase, resumeShowcase, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { ensureShowcaseWorkspace } from '@/lib/showcase/workspace'
import { showcaseHost } from '@/lib/showcase/host'
import { SHOWCASE_FREE_DAYS, SHOWCASE_PRICE_INR } from '@/lib/showcase/types'

// Showcase hosting, like the ad-free add-on (lib/billing/ad-free.ts): free for the first month from the first publish,
// then SHOWCASE_PRICE_INR a month from the workspace's wallet. A month's charge is keyed showcase:<site>:<YYYY-MM it
// starts>, so a double click or a cron retry charges once. The daily showcase_renew cron reminds three days ahead,
// charges what is due, retries a short wallet daily and pauses the site a week after its paid month ended; a later
// charge (the cron after a top-up, or Pay now) brings it back.

export const SHOWCASE_GRACE_DAYS = 7
export const SHOWCASE_REMIND_DAYS = 3
// A site paused for non-payment is still retried daily this long, so a top-up brings it back by itself.
const RETRY_PAUSED_DAYS = 90
const DAY_MS = 86_400_000
// A suspended or terminated workspace's site is neither served nor billed.
const WORKSPACE_OK = `NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = showcase_sites.tenant_id AND t.status IN ('suspended', 'terminated'))`

const CONSOLE = `https://ecom.${ROOT_DOMAIN}/dashboard`
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The workspace whose wallet pays: the site's own, else the owner's active one. */
export async function showcaseWalletTenant(site: Pick<ShowcaseSiteRow, 'tenantId' | 'ownerId'>): Promise<string | null> {
  if (site.tenantId) return site.tenantId
  const tenants = await getOwnerTenants(site.ownerId).catch(() => [])
  return tenants.find(t => t.status === 'active')?.id ?? null
}

export interface ShowcaseBilling {
  priceInr: number
  /** Still in the free month that started with the first publish. */
  free: boolean
  /** The paid month has ended. */
  lapsed: boolean
  /** Pay now is offered: the month ends within SHOWCASE_REMIND_DAYS or has ended. */
  due: boolean
  /** A live, lapsed site goes offline on this day unless it is paid. */
  pausesOn: string | null
}

export function showcaseBilling(site: ShowcaseSiteRow, now = Date.now()): ShowcaseBilling {
  const paid = site.paidUntil ? Date.parse(site.paidUntil) : null
  const published = site.publishedAt ? Date.parse(site.publishedAt) : null
  const lapsed = paid !== null && paid <= now
  return {
    priceInr: SHOWCASE_PRICE_INR,
    free: paid !== null && published !== null && paid - published <= (SHOWCASE_FREE_DAYS + 1) * DAY_MS && !lapsed,
    lapsed,
    due: site.status !== 'draft' && (paid === null || paid - now <= SHOWCASE_REMIND_DAYS * DAY_MS),
    pausesOn: site.status === 'live' && site.renew && lapsed ? new Date(paid! + SHOWCASE_GRACE_DAYS * DAY_MS).toISOString() : null,
  }
}

export type ShowcaseCharge =
  | { ok: true; charged: boolean; resumed: boolean; site: ShowcaseSiteRow }
  /** `wallet`: the wallet is short (or the debit failed); `no_wallet`: no workspace to pay from. */
  | { ok: false; code: 'not_found' | 'draft' | 'not_due' | 'no_page' | 'no_wallet' | 'wallet'; error: string; site: ShowcaseSiteRow | null }

// Never moves paid_until back, so running it twice for one month (a retry that found the month paid) is harmless.
const EXTEND_SQL = `UPDATE showcase_sites
    SET paid_until = GREATEST(COALESCE(paid_until, $2::timestamptz), $2::timestamptz + interval '1 month'),
        charge_failed_at = NULL, last_charge_error = NULL,
        status = CASE WHEN status = 'paused' AND pause_reason = 'unpaid' THEN 'live' ELSE status END,
        pause_reason = CASE WHEN status = 'paused' AND pause_reason = 'unpaid' THEN NULL ELSE pause_reason END,
        updated_at = now()
  WHERE id = $1`

/**
 * Charge one month of hosting. A live site's month follows on from paid_until (also inside the grace week, when it
 * was online); a paused, lapsed one starts today. A site paused for non-payment goes live again; one the owner
 * paused stays paused. The platform's own workspace is not charged.
 */
export async function chargeShowcaseMonth(siteId: string, opts: { reason: 'renewal' | 'manual' }): Promise<ShowcaseCharge> {
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.', site: null }
  if (site.status === 'draft' || !site.publishedAt) return { ok: false, code: 'draft', error: 'Publish the site first: its first month is free.', site }
  if (site.workspaceSuspended) return { ok: false, code: 'no_wallet', error: 'This workspace is suspended. Please contact support.', site }
  // A site without a workspace joins the owner's (or a new one) before its first charge.
  const tenantId = site.tenantId ?? (await ensureShowcaseWorkspace(site).catch(() => null))
  if (!tenantId) return { ok: false, code: 'no_wallet', error: 'This site has no workspace wallet to pay from.', site }
  const now = new Date()
  const paid = site.paidUntil ? new Date(site.paidUntil) : null
  const start = paid && (site.status === 'live' || paid > now) ? paid : now
  const params = [site.id, start.toISOString()]
  let charged = false
  if (isFlagshipTenant(tenantId)) {
    await controlPlanePool().query(EXTEND_SQL, params)
  } else {
    const res = await debitWallet({
      tenantId,
      amountInr: SHOWCASE_PRICE_INR,
      category: 'showcase',
      externalRef: `showcase:${site.id}:${start.toISOString().slice(0, 7)}`,
      note: `Showcase site ${showcaseHost(site.slug)}, month from ${start.toISOString().slice(0, 10)}${opts.reason === 'renewal' ? ' (auto-renew)' : ''}`,
      floorInr: 0,
      onCharged: async (client: PoolClient) => {
        await client.query(EXTEND_SQL, params)
      },
    })
    if (!res.ok) return { ok: false, code: 'wallet', error: res.error, site }
    charged = res.charged
    // This month was already paid (a cron retry, or two clicks at once): the site keeps it.
    if (!charged) await controlPlanePool().query(EXTEND_SQL, params)
  }
  const after = (await getShowcaseById(site.id)) ?? site
  const resumed = site.status === 'paused' && site.pauseReason === 'unpaid' && after.status === 'live'
  if (resumed) await notifyShowcase(after, { kind: 'resumed' }).catch(() => {})
  return { ok: true, charged, resumed, site: after }
}

/** Pay now from the console: only while a month is due (so a second click can't buy another month). */
export async function payShowcaseNow(siteId: string): Promise<ShowcaseCharge> {
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.', site: null }
  if (!showcaseBilling(site).due) return { ok: false, code: 'not_due', error: `Nothing to pay yet: hosting is paid until ${day(site.paidUntil!)}.`, site }
  return chargeShowcaseMonth(siteId, { reason: 'manual' })
}

/** Back online from the console: free while hosting is paid, else one month is charged first. */
export async function goLiveShowcase(siteId: string): Promise<ShowcaseCharge> {
  const first = await resumeShowcase(siteId)
  if (first.ok) return { ok: true, charged: false, resumed: true, site: first.site }
  if (first.code !== 'payment_due') return { ok: false, code: first.code, error: first.error, site: first.site ?? null }
  const paid = await chargeShowcaseMonth(siteId, { reason: 'manual' })
  if (!paid.ok) return paid
  const live = await resumeShowcase(siteId)
  if (live.ok) return { ok: true, charged: paid.charged, resumed: true, site: live.site }
  return { ok: false, code: live.code === 'payment_due' ? 'wallet' : live.code, error: live.error, site: live.site ?? paid.site }
}

// ── The daily cron ───────────────────────────────────────────────────────────

export interface ShowcaseRenewalRun {
  reminded: number
  due: number
  renewed: number
  paused: number
  ended: number
  failed: { siteId: string; error: string }[]
}

export async function runShowcaseRenewals(): Promise<ShowcaseRenewalRun> {
  const pool = controlPlanePool()
  const run: ShowcaseRenewalRun = { reminded: 0, due: 0, renewed: 0, paused: 0, ended: 0, failed: [] }

  // Three days ahead, once per paid month (marked before sending, so a mail error can't send it twice).
  const remind = await pool.query(
    `UPDATE showcase_sites SET renewal_reminded_for = paid_until
      WHERE status = 'live' AND renew AND paid_until > now() + interval '1 day' AND paid_until <= now() + make_interval(days => $1::int)
        AND renewal_reminded_for IS DISTINCT FROM paid_until AND ${WORKSPACE_OK}
      RETURNING id`,
    [SHOWCASE_REMIND_DAYS]
  )
  for (const { id } of remind.rows) {
    const site = await getShowcaseById(id)
    if (!site) continue
    const tenantId = await showcaseWalletTenant(site)
    const balance = tenantId && !isFlagshipTenant(tenantId) ? (await getWalletBalance(tenantId)).balance : null
    await notifyShowcase(site, { kind: 'reminder', balance }).catch(() => {})
    run.reminded++
  }

  // Due within a day: live sites on auto-renew, and those paused for non-payment (a top-up brings them back).
  const due = await pool.query(
    `SELECT id FROM showcase_sites
      WHERE renew AND paid_until IS NOT NULL AND paid_until < now() + interval '1 day'
        AND (status = 'live' OR (status = 'paused' AND pause_reason = 'unpaid' AND paid_until > now() - make_interval(days => $1::int)))
        AND ${WORKSPACE_OK}
      ORDER BY paid_until`,
    [RETRY_PAUSED_DAYS]
  )
  run.due = due.rowCount ?? 0
  for (const { id } of due.rows) {
    const r = await chargeShowcaseMonth(id, { reason: 'renewal' }).catch(e => ({ ok: false as const, code: 'wallet' as const, error: String(e?.message || e), site: null }))
    if (r.ok) {
      if (r.charged) run.renewed++
      continue
    }
    run.failed.push({ siteId: id, error: r.error })
    const site = r.site ?? (await getShowcaseById(id))
    if (site && (await chargeFailed(site, r.error))) run.paused++
  }

  // Auto-renew off: a live site goes offline when its paid month ends.
  const ended = await pool.query(
    `UPDATE showcase_sites SET status = 'paused', pause_reason = 'unpaid', updated_at = now()
      WHERE status = 'live' AND NOT renew AND paid_until IS NOT NULL AND paid_until <= now()
      RETURNING id`
  )
  for (const { id } of ended.rows) {
    const site = await getShowcaseById(id)
    if (site) await notifyShowcase(site, { kind: 'ended' }).catch(() => {})
    run.ended++
  }
  return run
}

/** A renewal that didn't go through: the owner hears once; a week past the paid month the site pauses. True when paused. */
async function chargeFailed(site: ShowcaseSiteRow, error: string): Promise<boolean> {
  const pool = controlPlanePool()
  await pool.query(
    `UPDATE showcase_sites SET charge_failed_at = COALESCE(charge_failed_at, now()), last_charge_error = $2, updated_at = now() WHERE id = $1`,
    [site.id, error.slice(0, 500)]
  )
  if (site.status !== 'live' || !site.paidUntil) return false
  const pausesOn = new Date(Date.parse(site.paidUntil) + SHOWCASE_GRACE_DAYS * DAY_MS)
  if (pausesOn.getTime() <= Date.now()) {
    const paused = await pauseShowcase(site.id, 'unpaid')
    if (paused?.status !== 'paused') return false
    await notifyShowcase(paused, { kind: 'paused' }).catch(() => {})
    return true
  }
  if (!site.chargeFailedAt) await notifyShowcase(site, { kind: 'failed', pausesOn }).catch(() => {})
  return false
}

// ── Owner emails ─────────────────────────────────────────────────────────────

type Notice =
  | { kind: 'reminder'; balance: number | null }
  | { kind: 'failed'; pausesOn: Date }
  | { kind: 'paused' }
  | { kind: 'ended' }
  | { kind: 'resumed' }

async function notifyShowcase(site: ShowcaseSiteRow, n: Notice): Promise<void> {
  const owner = await getOwnerById(site.ownerId)
  if (!owner?.email) return
  const slug = site.tenantId
    ? ((await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [site.tenantId]).catch(() => null))?.rows[0]?.slug as string | undefined)
    : undefined
  const q = slug ? `?tenant=${encodeURIComponent(slug)}` : ''
  const page = { href: `${CONSOLE}/showcase${q}`, label: 'Open your site settings' }
  const wallet = { href: `${CONSOLE}/wallet${q}`, label: 'Top up the wallet' }
  const host = `<strong>${showcaseHost(site.slug)}</strong>`
  const name = esc(site.business.name?.trim() || site.slug)
  const price = inr(SHOWCASE_PRICE_INR)
  const to = { email: owner.email, name: owner.name }
  const paidUntil = site.paidUntil ? day(site.paidUntil) : ''

  if (n.kind === 'reminder') {
    const short = n.balance !== null && n.balance < SHOWCASE_PRICE_INR
    return sendShowcaseEmail(to, {
      subject: `${site.business.name?.trim() || 'Your site'}: hosting renews on ${paidUntil}`,
      title: 'Your site renews soon',
      lines: [`Hosting for ${name}'s site ${host} renews on <strong>${paidUntil}</strong> for ${price} from your wallet.`],
      ...(short ? { warn: `Your wallet has ${inr(n.balance!)}. Top up before ${paidUntil} to keep the site online.` } : {}),
      cta: short ? wallet : page,
    })
  }
  if (n.kind === 'failed') {
    return sendShowcaseEmail(to, {
      subject: `We couldn't renew ${showcaseHost(site.slug)}`,
      title: "We couldn't renew your site",
      lines: [`Your wallet is short of the ${price} monthly hosting for ${host}. We'll try again every day.`],
      warn: `If it is still short on ${day(n.pausesOn)}, the site goes offline until it is paid.`,
      cta: wallet,
    })
  }
  if (n.kind === 'paused') {
    return sendShowcaseEmail(to, {
      subject: `${showcaseHost(site.slug)} is offline`,
      title: 'Your site is offline',
      lines: [
        `We paused ${host} because its hosting wasn't paid. Your page and its enquiries are kept.`,
        `Top up your wallet and it comes back within a day, or pay ${price} from the Showcase page to bring it back now.`,
      ],
      cta: page,
    })
  }
  if (n.kind === 'ended') {
    return sendShowcaseEmail(to, {
      subject: `${showcaseHost(site.slug)} is offline`,
      title: 'Your site is offline',
      lines: [
        `Auto-renew was off, so ${host} went offline when its paid month ended on ${paidUntil}. Your page and its enquiries are kept.`,
        `Pay ${price} from the Showcase page to bring it back.`,
      ],
      cta: page,
    })
  }
  return sendShowcaseEmail(to, {
    subject: `${showcaseHost(site.slug)} is back online`,
    title: 'Your site is back online',
    lines: [`Thanks, the payment went through and ${host} is live again.`],
    rows: [{ label: 'Paid until', value: paidUntil }],
    cta: page,
  })
}
