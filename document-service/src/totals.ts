import type { RenderDocumentRequest } from '@jeffi/api-contracts'
import { calculateGST, isInterState, getStateCode, round2 } from '@jeffi/gst'

export interface LineTotals {
  description: string
  hsn: string | null
  quantity: number
  unit: string | null
  unit_price: number
  gst_rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}
export interface Totals {
  subtotal: number
  discount: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  is_igst: boolean
  lines: LineTotals[]
}

/** GST split per line. Inter-state (buyer state ≠ seller state) → IGST, else CGST+SGST. */
export function computeTotals(req: RenderDocumentRequest): Totals {
  const sellerCode = req.seller.state ? getStateCode(req.seller.state) : (req.seller.gstin?.slice(0, 2) ?? '')
  const igst = !!req.buyer.state && !!sellerCode && isInterState(req.buyer.state, sellerCode)
  const lines: LineTotals[] = req.items.map(it => {
    const gross = round2(it.unit_price * it.quantity - it.discount)
    let taxable: number, tax: number
    if (req.prices_include_gst) {
      const b = calculateGST(gross, it.gst_rate, igst)
      taxable = b.taxableAmount
      tax = b.totalTax
    } else {
      taxable = gross
      tax = round2((gross * it.gst_rate) / 100)
    }
    const half = round2(tax / 2)
    return {
      description: it.description,
      hsn: it.hsn ?? null,
      quantity: it.quantity,
      unit: it.unit ?? null,
      unit_price: it.unit_price,
      gst_rate: it.gst_rate,
      taxable,
      cgst: igst ? 0 : half,
      sgst: igst ? 0 : round2(tax - half),
      igst: igst ? tax : 0,
      total: round2(taxable + tax),
    }
  })
  const sum = (k: keyof LineTotals) => round2(lines.reduce((a, l) => a + Number(l[k]), 0))
  return {
    subtotal: round2(req.items.reduce((a, i) => a + i.unit_price * i.quantity, 0)),
    discount: round2(req.items.reduce((a, i) => a + i.discount, 0)),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    total: sum('total'),
    is_igst: igst,
    lines,
  }
}
