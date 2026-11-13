import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { sendDomainEmail } from '@/lib/shared/ecom-emails'

// Owner emails about a bought domain. Never throws: a failed email must not stall the job.

const ECOM = () => (process.env.NEXT_PUBLIC_ECOM_URL || 'https://ecom.jeffistores.in').replace(/\/$/, '')
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

export type DomainNotice =
  | { kind: 'active'; domain: string; hosts: string[]; expiresAt: string | null; renewalPriceInr: number | null; autoRenew: boolean; email: string }
  | { kind: 'failed'; domain: string; reason: string; refundedInr: number }
  | { kind: 'cancelled'; domain: string; reason: string }
  | { kind: 'wallet_short'; domain: string; priceInr: number; balanceInr: number }
  | { kind: 'renewal_short'; domain: string; priceInr: number; balanceInr: number; expiresAt: string; cutoff: string }
  | { kind: 'renewal_failed'; domain: string; reason: string; refundedInr: number; expiresAt: string }
  | { kind: 'renewal_lapsed'; domain: string; expiresAt: string }
  | { kind: 'renewed'; domain: string; priceInr: number; expiresAt: string }
  | { kind: 'renewal_off'; domain: string; expiresAt: string; renewalPriceInr: number }
  | { kind: 'expired'; domain: string }

function compose(n: DomainNotice): Parameters<typeof sendDomainEmail>[1] {
  const cta = { href: `${ECOM()}/dashboard/domains`, label: 'Open your domains' }
  switch (n.kind) {
    case 'active':
      return {
        subject: `${n.domain} is live`,
        title: `${n.domain} is live`,
        lines: [`Your domain is registered and now serves your store.`],
        rows: [
          { label: 'Store', value: `https://${n.domain}` },
          { label: 'Admin panel', value: `https://admin.${n.domain}` },
          ...(n.hosts.filter(h => h !== n.domain && !h.startsWith('www.') && !h.startsWith('admin.')).length
            ? [{ label: 'Also', value: n.hosts.filter(h => h !== n.domain && !h.startsWith('www.') && !h.startsWith('admin.')).join(', ') }]
            : []),
          ...(n.expiresAt ? [{ label: 'Renews on', value: `${day(n.expiresAt)}${n.renewalPriceInr ? `, ${inr(n.renewalPriceInr)} from your wallet` : ''}${n.autoRenew ? '' : ' (auto-renew is off)'}` }] : []),
        ],
        warn: `The domain registry emails ${n.email} to confirm the contact address. Click the link within 15 days or the domain is suspended.`,
        cta,
      }
    case 'failed':
      return {
        subject: `We couldn't register ${n.domain}`,
        title: `${n.domain} wasn't registered`,
        lines: [`The registry did not accept the registration: ${n.reason}`, `${inr(n.refundedInr)} is back in your wallet. You can try another name.`],
        cta,
      }
    case 'cancelled':
      return { subject: `${n.domain} wasn't bought`, title: `${n.domain} wasn't bought`, lines: [n.reason, 'Nothing was charged. You can pick another name.'], cta }
    case 'wallet_short':
      return {
        subject: `Top up to buy ${n.domain}`,
        title: `Top up to buy ${n.domain}`,
        lines: [`${n.domain} costs ${inr(n.priceInr)} for the first year and your wallet has ${inr(n.balanceInr)}. Top up ${inr(n.priceInr - n.balanceInr)} and we'll buy it.`],
        cta: { href: `${ECOM()}/dashboard/wallet`, label: 'Top up your wallet' },
      }
    case 'renewal_short':
      return {
        subject: `Top up to renew ${n.domain}`,
        title: `${n.domain} needs a top-up to renew`,
        lines: [
          `${n.domain} expires on ${day(n.expiresAt)}. Renewing it for a year costs ${inr(n.priceInr)} and your wallet has ${inr(n.balanceInr)}.`,
          `We'll try again every day until ${day(n.cutoff)}. After that the domain is not renewed and stops working when it expires.`,
        ],
        cta: { href: `${ECOM()}/dashboard/wallet`, label: 'Top up your wallet' },
      }
    case 'renewal_failed':
      return {
        subject: `Renewal of ${n.domain} didn't go through`,
        title: `Renewal of ${n.domain} didn't go through`,
        lines: [`The registry did not accept the renewal: ${n.reason}`, `${inr(n.refundedInr)} is back in your wallet. We'll try again tomorrow; the domain expires on ${day(n.expiresAt)}.`],
        cta,
      }
    case 'renewal_lapsed':
      return {
        subject: `${n.domain} will expire`,
        title: `${n.domain} will expire on ${day(n.expiresAt)}`,
        lines: [`We couldn't renew ${n.domain} in time, so it will not be renewed. Your store stays on its jeffistores.in address.`],
        cta,
      }
    case 'renewed':
      return { subject: `${n.domain} renewed`, title: `${n.domain} renewed`, lines: [`${n.domain} is renewed until ${day(n.expiresAt)}. ${inr(n.priceInr)} was charged to your wallet.`], cta }
    case 'renewal_off':
      return {
        subject: `${n.domain} expires on ${day(n.expiresAt)}`,
        title: `${n.domain} expires soon`,
        lines: [`Auto-renew is off for ${n.domain}. It expires on ${day(n.expiresAt)}. Turn auto-renew on to keep it (${inr(n.renewalPriceInr)} a year from your wallet).`],
        cta,
      }
    case 'expired':
      return { subject: `${n.domain} expired`, title: `${n.domain} expired`, lines: [`${n.domain} expired and no longer points at your store. Your store stays on its jeffistores.in address.`], cta }
  }
}

export async function notifyDomain(tenantId: string, notice: DomainNotice): Promise<void> {
  try {
    const r = await controlPlanePool().query(
      `SELECT o.email, o.name FROM owner_tenants ot JOIN owners o ON o.id = ot.owner_id WHERE ot.tenant_id = $1 ORDER BY ot.created_at LIMIT 1`,
      [tenantId]
    )
    const owner = r.rows[0]
    if (!owner) return
    await sendDomainEmail({ email: owner.email, name: owner.name }, compose(notice))
  } catch (e: any) {
    console.warn('[domains] notice not sent', notice.kind, e?.message || e)
  }
}
