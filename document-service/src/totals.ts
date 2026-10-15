import type { RenderDocumentRequest } from '@jeffi/api-contracts'
import { calculateGST, isInterState, getStateCode, round2 } from '@jeffi/gst'

export interface LineTotals {
  description: string
  hsn: string | null
  quantity: number
  unit: string | null
  unit_price: number
  gst_rate: number
  /** Line discount plus its share of the document discount. */
  discount: number
  /** The line's own discount as given (`discount_pct` or the amount as a % of the line). */
  discount_pct: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}
export interface ChargeTotals { label: string; hsn: string | null; amount: number; gst_rate: number; taxable: number; tax: number; total: number }
export interface Totals {
  subtotal: number
  /** Line discounts. */
  line_discount: number
  /** The document-level discount and its label. */
  doc_discount: number
  doc_discount_label: string | null
  discount: number
  charges: ChargeTotals[]
  charges_total: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  round_off: number
  total: number
  amount_paid: number
  balance_due: number
  is_igst: boolean
  lines: LineTotals[]
}

/** GST on an amount; inter-state (buyer state ≠ seller state) → IGST, else CGST+SGST. */
function tax(amount: number, rate: number, inclusive: boolean, igst: boolean) {
  const t = inclusive ? calculateGST(amount, rate, igst).totalTax : round2((amount * rate) / 100)
  const taxable = inclusive ? round2(amount - t) : amount
  const half = round2(t / 2)
  return { taxable, tax: t, cgst: igst ? 0 : half, sgst: igst ? 0 : round2(t - half), igst: igst ? t : 0, total: round2(taxable + t) }
}

export function computeTotals(req: RenderDocumentRequest): Totals {
  const sellerCode = req.seller.state ? getStateCode(req.seller.state) : (req.seller.gstin?.slice(0, 2) ?? '')
  const igst = !!req.buyer.state && !!sellerCode && isInterState(req.buyer.state, sellerCode)
  const inclusive = req.prices_include_gst

  const gross = req.items.map(it => round2(it.unit_price * it.quantity))
  const own = req.items.map((it, i) => it.discount_pct != null ? round2((gross[i] * it.discount_pct) / 100) : Math.min(it.discount, gross[i]))
  const net = gross.map((g, i) => round2(g - own[i]))
  const netSum = round2(net.reduce((a, n) => a + n, 0))

  // Document discount spread by each line's share; the last line takes the rounding remainder.
  const d = req.discount
  const docDiscount = d ? Math.min(netSum, round2(d.amount ?? (netSum * (d.percent ?? 0)) / 100)) : 0
  const share = net.map(n => (netSum > 0 ? round2((docDiscount * n) / netSum) : 0))
  if (share.length) share[share.length - 1] = round2(docDiscount - share.slice(0, -1).reduce((a, n) => a + n, 0))

  const lines: LineTotals[] = req.items.map((it, i) => {
    const t = tax(round2(net[i] - share[i]), it.gst_rate, inclusive, igst)
    return {
      description: it.description, hsn: it.hsn ?? null, quantity: it.quantity, unit: it.unit ?? null,
      unit_price: it.unit_price, gst_rate: it.gst_rate,
      discount: round2(own[i] + share[i]),
      discount_pct: it.discount_pct ?? (gross[i] > 0 ? round2((own[i] / gross[i]) * 100) : 0),
      taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
    }
  })
  const charges: ChargeTotals[] = (req.charges ?? []).map(c => {
    const t = tax(c.amount, c.gst_rate, inclusive, igst)
    return { label: c.label, hsn: c.hsn ?? null, amount: c.amount, gst_rate: c.gst_rate, taxable: t.taxable, tax: t.tax, total: t.total }
  })

  const add = (xs: number[]) => round2(xs.reduce((a, n) => a + n, 0))
  const lineTax = (k: 'cgst' | 'sgst' | 'igst') => add(lines.map(l => l[k]))
  const chargeTax = add(charges.map(c => c.tax))
  const half = round2(chargeTax / 2)
  const exact = round2(add(lines.map(l => l.total)) + add(charges.map(c => c.total)))
  const total = req.round_off ? Math.round(exact) : exact
  const lineDiscount = add(own)
  const paid = round2(Math.min(req.amount_paid ?? 0, total))
  return {
    subtotal: add(gross),
    line_discount: lineDiscount,
    doc_discount: docDiscount,
    doc_discount_label: d ? (d.label || (d.percent != null ? `Discount (${d.percent}%)` : 'Discount')) : null,
    discount: round2(lineDiscount + docDiscount),
    charges,
    charges_total: add(charges.map(c => c.amount)),
    taxable: round2(add(lines.map(l => l.taxable)) + add(charges.map(c => c.taxable))),
    cgst: round2(lineTax('cgst') + (igst ? 0 : half)),
    sgst: round2(lineTax('sgst') + (igst ? 0 : round2(chargeTax - half))),
    igst: round2(lineTax('igst') + (igst ? chargeTax : 0)),
    round_off: round2(total - exact),
    total,
    amount_paid: paid,
    balance_due: round2(total - paid),
    is_igst: igst,
    lines,
  }
}
