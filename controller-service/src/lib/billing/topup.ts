import { rechargeWallet } from '@/lib/payments/wallet'
import { issuePlatformInvoiceLater } from './platform-invoice'
import { topupAmounts } from './topup-amounts'

// Wallet top-ups: 18% GST is charged on top of the credit (pay ₹1180 → ₹1000 balance) and a tax
// invoice is issued. Used by the ecom console, the store admin and the Razorpay webhook fallback.

export { topupAmounts } from './topup-amounts'
const r2 = (n: number) => Math.round(n * 100) / 100

export function topupNotes(tenant: { id: string; slug?: string | null }, creditInr: number) {
  const a = topupAmounts(creditInr)
  return { purpose: 'wallet_topup', tenant_id: tenant.id, tenant_slug: tenant.slug ?? '', credit_inr: String(a.credit), gst_inr: String(a.gst) }
}

/** Credit a paid top-up (idempotent on the payment id) and issue its invoice. */
export async function creditTopup(p: { tenantId: string; paymentId: string; paidPaise: number; notes?: Record<string, unknown> | null }) {
  const paid = r2(Number(p.paidPaise) / 100)
  // Orders made before GST-on-top carry no credit_inr: the whole payment was the credit.
  const credit = Number(p.notes?.credit_inr) > 0 ? Math.min(Number(p.notes!.credit_inr), paid) : paid
  const r = await rechargeWallet({ tenantId: p.tenantId, amountInr: credit, note: `Razorpay top-up ${p.paymentId}`, externalRef: p.paymentId })
  if (r.ok && Number(p.notes?.credit_inr) > 0) {
    issuePlatformInvoiceLater({
      tenantId: p.tenantId, kind: 'wallet_topup', externalRef: p.paymentId, sac: '998315',
      description: `Jeffi wallet top-up (prepaid platform credit ₹${credit.toLocaleString('en-IN')})`,
      amountInr: credit, pricesIncludeGst: false, credited: credit,
    })
  }
  return r
}
