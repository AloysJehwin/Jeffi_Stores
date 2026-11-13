import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { creditWallet, debitWallet, getWalletBalance } from '@/lib/payments/wallet'
import { domainProviders, RegistrarError } from './providers'
import { getDomainPricing, quoteTld, tldOf, tldPrices } from './pricing'
import { expireOrder, getOrder, patchOrder, withLock, type DomainOrder } from './orders'
import { notifyDomain } from './notify'

// Yearly renewal policy (docs/DOMAIN_PURCHASE.md):
//  - AWS auto-renew is off on every domain, so AWS never renews on its own at the platform's cost.
//  - renewLeadDays (30) before expiry a renewal row opens for the term. With auto-renew on, the wallet is
//    debited the current renewal price + margin; RenewDomain is called only after that debit succeeds.
//  - A short wallet: email the owner, retry daily, re-email every 5 days. Still unpaid renewCutoffDays (3)
//    before expiry → 'lapsed': no renewal; the domain stops serving when it expires.
//  - The registry rejecting a renewal refunds the debit and retries the next day, within the same window.
//  - Only an active store renews; a suspended or closed store's domain is retried, then lapses at the cut-off.
//  - Auto-renew off: reminders at the window, 7 days and 1 day before expiry; then it expires.

const pool = () => controlPlanePool()
const DAY = 86400_000
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface DomainRenewal {
  id: string
  order_id: string
  tenant_id: string
  term_expires_at: string
  status: 'due' | 'renewing' | 'done' | 'lapsed' | 'off'
  cost_usd: number | null
  price_inr: number | null
  charge_ref: string | null
  operation_id: string | null
  attempts: number
  next_at: string | null
  notified_at: string | null
  last_error: string | null
}

function row(r: any): DomainRenewal {
  return {
    ...r,
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    term_expires_at: new Date(r.term_expires_at).toISOString(),
    next_at: r.next_at ? new Date(r.next_at).toISOString() : null,
    notified_at: r.notified_at ? new Date(r.notified_at).toISOString() : null,
  }
}

async function patch(id: string, cols: Record<string, unknown>): Promise<DomainRenewal> {
  const keys = Object.keys(cols)
  const r = await pool().query(
    `UPDATE tenant_domain_renewals SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...keys.map(k => cols[k])]
  )
  return row(r.rows[0])
}

/** The renewal of the order's current term, if its window is open. */
export async function currentRenewal(orderId: string): Promise<DomainRenewal | null> {
  const r = await pool().query(
    `SELECT r.* FROM tenant_domain_renewals r JOIN tenant_domain_orders o ON o.id = r.order_id AND r.term_expires_at = o.expires_at
      WHERE r.order_id = $1 LIMIT 1`,
    [orderId]
  )
  return r.rows[0] ? row(r.rows[0]) : null
}

/** Open a renewal for every live domain entering its renewal window. */
export async function openRenewals(): Promise<number> {
  const { renewLeadDays } = await getDomainPricing()
  const r = await pool().query(
    `INSERT INTO tenant_domain_renewals (order_id, tenant_id, term_expires_at, status, next_at)
     SELECT o.id, o.tenant_id, o.expires_at, CASE WHEN o.auto_renew THEN 'due' ELSE 'off' END, now()
       FROM tenant_domain_orders o
      WHERE o.status IN ('active','configuring') AND o.expires_at IS NOT NULL
        AND o.expires_at <= now() + make_interval(days => $1) AND o.expires_at > now()
     ON CONFLICT (order_id, term_expires_at) DO NOTHING`,
    [renewLeadDays]
  )
  return r.rowCount ?? 0
}

/** Auto-renew toggled: the open renewal follows it (a lapsed or finished one stays as it is). */
export async function syncRenewalWithAutoRenew(o: DomainOrder): Promise<void> {
  if (!o.expires_at) return
  await pool().query(
    `UPDATE tenant_domain_renewals SET status = $3, next_at = now(), updated_at = now()
      WHERE order_id = $1 AND term_expires_at = $2 AND status IN ('due','off')`,
    [o.id, o.expires_at, o.auto_renew ? 'due' : 'off']
  )
}

async function renewalQuote(o: DomainOrder) {
  const tld = tldOf(o.domain, (await tldPrices()).keys())
  const q = tld ? await quoteTld(tld) : null
  if (!q) throw new RegistrarError('UnsupportedTLD', `.${o.domain.split('.').slice(1).join('.')} renewal price is unavailable`, true)
  return q
}

async function refund(r: DomainRenewal, o: DomainOrder, reason: string): Promise<void> {
  if (!r.charge_ref || !r.price_inr) return
  const c = await creditWallet({ tenantId: o.tenant_id, amountInr: r.price_inr, category: 'domain', externalRef: `${r.charge_ref}:rf`, note: `Refund: renewal of ${o.domain} (${reason})` })
  if (!c.ok) throw new Error(`refund failed: ${c.error}`)
}

/** Move one renewal as far as it goes now. */
export async function advanceRenewal(id: string, opts: { force?: boolean } = {}): Promise<DomainRenewal | null> {
  return withLock(`domain_renewal:${id}`, async () => {
    const found = await pool().query(`SELECT * FROM tenant_domain_renewals WHERE id = $1`, [id])
    if (!found.rows[0]) return null
    let r = row(found.rows[0])
    if (!opts.force && r.next_at && new Date(r.next_at).getTime() > Date.now()) return r
    const o = await getOrder(r.order_id)
    if (!o) return r
    const { registrar } = await domainProviders()
    const settings = await getDomainPricing()
    const expires = new Date(r.term_expires_at)
    const cutoff = new Date(expires.getTime() - settings.renewCutoffDays * DAY)
    const now = Date.now()

    if (r.status === 'off') {
      const daysLeft = (expires.getTime() - now) / DAY
      const last = r.notified_at ? new Date(r.notified_at).getTime() : 0
      const remind = !last || (daysLeft <= 7 && last < expires.getTime() - 7 * DAY) || (daysLeft <= 1 && last < expires.getTime() - DAY)
      if (remind && o.status === 'active') {
        const q = await renewalQuote(o).catch(() => null)
        await notifyDomain(o.tenant_id, { kind: 'renewal_off', domain: o.domain, expiresAt: r.term_expires_at, renewalPriceInr: q?.renewalPriceInr ?? 0 })
        r = await patch(r.id, { notified_at: new Date(), next_at: new Date(now + DAY) })
      } else r = await patch(r.id, { next_at: new Date(now + DAY) })
      return r
    }

    if (r.status === 'due') {
      if (o.status !== 'active' && o.status !== 'configuring') return patch(r.id, { status: 'lapsed', next_at: null, last_error: `domain is ${o.status}` })
      if (now >= cutoff.getTime()) {
        await patchOrder(o.id, { event: { step: 'renewal', message: `Not renewed: no payment before ${cutoff.toISOString().slice(0, 10)}. Expires ${r.term_expires_at.slice(0, 10)}`, level: 'warn' } })
        await notifyDomain(o.tenant_id, { kind: 'renewal_lapsed', domain: o.domain, expiresAt: r.term_expires_at })
        return patch(r.id, { status: 'lapsed', next_at: null })
      }
      // Only a running store renews; a suspended or closed one is retried like a short wallet, then lapses.
      const store = (await pool().query(`SELECT status FROM tenants WHERE id = $1`, [o.tenant_id])).rows[0]?.status
      if (store !== 'active') return patch(r.id, { attempts: r.attempts + 1, last_error: `store is ${store ?? 'gone'}`, next_at: new Date(Math.min(now + DAY, cutoff.getTime())) })
      try {
        const q = await renewalQuote(o)
        // The ref is saved before the debit, so a retry after a crash finds the charge instead of taking a second one.
        const ref = r.charge_ref ?? `domain_renew:${o.id}:${now.toString(36)}`
        if (!r.charge_ref) r = await patch(r.id, { charge_ref: ref, price_inr: q.renewalPriceInr, cost_usd: q.renewalCostUsd, usd_inr: q.usdInr, margin: q.margin })
        const res = await debitWallet({ tenantId: o.tenant_id, amountInr: r.price_inr ?? q.renewalPriceInr, category: 'domain', externalRef: ref, note: `Domain ${o.domain}, renewal to ${expires.getUTCFullYear() + 1}`, floorInr: 0 })
        if (!res.ok) {
          const { balance } = await getWalletBalance(o.tenant_id)
          const last = r.notified_at ? new Date(r.notified_at).getTime() : 0
          if (now - last > 5 * DAY) {
            await notifyDomain(o.tenant_id, { kind: 'renewal_short', domain: o.domain, priceInr: r.price_inr ?? q.renewalPriceInr, balanceInr: balance, expiresAt: r.term_expires_at, cutoff: cutoff.toISOString() })
            await patchOrder(o.id, { event: { step: 'renewal', message: `Renewal waiting for wallet balance: ₹${(r.price_inr ?? q.renewalPriceInr).toLocaleString('en-IN')} needed`, level: 'warn' } })
            r = await patch(r.id, { notified_at: new Date() })
          }
          return patch(r.id, { attempts: r.attempts + 1, last_error: 'wallet balance too low', next_at: new Date(Math.min(now + DAY, cutoff.getTime())) })
        }
        const { operationId } = await registrar.renew(o.domain, expires.getUTCFullYear())
        await patchOrder(o.id, { event: { step: 'renewal', message: `Renewal charged (₹${(r.price_inr ?? 0).toLocaleString('en-IN')}) and submitted to the registry` } })
        return patch(r.id, { status: 'renewing', operation_id: operationId, last_error: null, next_at: new Date(now + (registrar.live ? 10 * 60_000 : 5_000)) })
      } catch (e) {
        const retry = !(e instanceof RegistrarError) || e.retryable
        if (!retry && r.charge_ref) {
          await refund(r, o, errText(e))
          await notifyDomain(o.tenant_id, { kind: 'renewal_failed', domain: o.domain, reason: errText(e), refundedInr: r.price_inr ?? 0, expiresAt: r.term_expires_at })
          return patch(r.id, { charge_ref: null, attempts: r.attempts + 1, last_error: errText(e), next_at: new Date(Math.min(now + DAY, cutoff.getTime())) })
        }
        return patch(r.id, { attempts: r.attempts + 1, last_error: errText(e), next_at: new Date(now + Math.min(60_000 * 2 ** (r.attempts + 1), 3600_000)) })
      }
    }

    if (r.status === 'renewing' && r.operation_id) {
      try {
        const op = await registrar.operation(r.operation_id)
        if (op.status === 'SUBMITTED' || op.status === 'IN_PROGRESS') return patch(r.id, { next_at: new Date(now + (registrar.live ? 10 * 60_000 : 5_000)) })
        if (op.status === 'SUCCESSFUL') {
          const detail = await registrar.domainDetail(o.domain).catch(() => null)
          const next = detail?.expiresAt && detail.expiresAt > expires ? detail.expiresAt : new Date(expires.getTime() + 365 * DAY)
          await patchOrder(o.id, { expires_at: next, event: { step: 'renewal', message: `Renewed until ${next.toISOString().slice(0, 10)}` } })
          await notifyDomain(o.tenant_id, { kind: 'renewed', domain: o.domain, priceInr: r.price_inr ?? 0, expiresAt: next.toISOString() })
          return patch(r.id, { status: 'done', next_at: null, last_error: null })
        }
        const reason = op.message || `renewal ${op.status.toLowerCase()}`
        await refund(r, o, reason)
        await patchOrder(o.id, { event: { step: 'renewal', message: `Renewal failed: ${reason}. Refunded; retrying tomorrow`, level: 'error' } })
        await notifyDomain(o.tenant_id, { kind: 'renewal_failed', domain: o.domain, reason, refundedInr: r.price_inr ?? 0, expiresAt: r.term_expires_at })
        return patch(r.id, { status: 'due', charge_ref: null, operation_id: null, attempts: r.attempts + 1, last_error: reason, next_at: new Date(Math.min(now + DAY, cutoff.getTime())) })
      } catch (e) {
        return patch(r.id, { attempts: r.attempts + 1, last_error: errText(e), next_at: new Date(now + Math.min(60_000 * 2 ** (r.attempts + 1), 3600_000)) })
      }
    }
    return r
  })
}

export async function advanceDueRenewals(opts: { only?: 'renewing' } = {}): Promise<{ advanced: number; errors: { id: string; error: string }[] }> {
  const due = await pool().query(
    `SELECT id FROM tenant_domain_renewals WHERE status = ANY($1::text[]) AND (next_at IS NULL OR next_at <= now()) ORDER BY term_expires_at LIMIT 500`,
    [opts.only ? [opts.only] : ['due', 'renewing', 'off']]
  )
  const errors: { id: string; error: string }[] = []
  let advanced = 0
  for (const { id } of due.rows) {
    try {
      if (await advanceRenewal(id)) advanced++
    } catch (e) {
      errors.push({ id, error: errText(e) })
    }
  }
  return { advanced, errors }
}

/** Live domains past their expiry with no renewal still at the registry. */
export async function expireLapsedOrders(): Promise<number> {
  const r = await pool().query(
    `SELECT o.id FROM tenant_domain_orders o
      WHERE o.status IN ('active','configuring') AND o.expires_at < now()
        AND NOT EXISTS (SELECT 1 FROM tenant_domain_renewals r WHERE r.order_id = o.id AND r.term_expires_at = o.expires_at AND r.status = 'renewing')`
  )
  for (const { id } of r.rows) {
    const o = await getOrder(id)
    if (o) await expireOrder(o)
  }
  return r.rows.length
}

/** The daily job. */
export async function runDomainRenewCron() {
  const opened = await openRenewals()
  const renewals = await advanceDueRenewals()
  const expired = await expireLapsedOrders()
  return { opened, ...renewals, expired }
}
