import QRCode from 'qrcode'
import type { RenderDocumentRequest, DocumentType } from '@jeffi/api-contracts'
import type { Totals } from '../totals.js'

// One normalised view of a document; every design renders from this, so per-type rules live here once.

export type FontKey = 'modern' | 'geometric' | 'classic' | 'editorial' | 'technical' | 'system'

export interface Branding {
  accent?: string
  font?: FontKey
  logo?: Buffer | null
}

export interface PartyView {
  name: string
  lines: string[]
  gstin?: string
}

export interface LineView {
  description: string
  hsn: string | null
  quantity: number
  unit: string | null
  rate: number
  gstRate: number
  discount: number
  discountPct: number
  taxable: number
  total: number
}

export interface DocModel {
  type: DocumentType
  title: string
  number: string
  date: string
  due?: { label: string; date: string }
  seller: PartyView
  buyer: PartyView
  shipTo?: PartyView
  labels: { from: string; to: string; ship: string }
  lines: LineView[]
  showPrices: boolean
  showTax: boolean
  totals: Totals
  amountWords: string
  notes?: string
  terms?: string
  reference?: string
  stamp?: string
  viewUrl: string
  qr: string
  logo?: Buffer | null
}

const TITLE: Record<DocumentType, string> = {
  invoice: 'Tax Invoice',
  quotation: 'Quotation',
  receipt: 'Receipt',
  packing_slip: 'Packing Slip',
  label: 'Shipping Label',
  purchase_order: 'Purchase Order',
}

export const fmtDate = (s?: string) =>
  (s ? new Date(s) : new Date()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export const money = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`)
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ')

/** 125000.5 → "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only" (Indian grouping). */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - rupees) * 100)
  const parts: string[] = []
  const crore = Math.floor(rupees / 1e7), lakh = Math.floor((rupees % 1e7) / 1e5)
  const thousand = Math.floor((rupees % 1e5) / 1e3), rest = rupees % 1e3
  if (crore) parts.push(`${three(crore)} Crore`)
  if (lakh) parts.push(`${two(lakh)} Lakh`)
  if (thousand) parts.push(`${two(thousand)} Thousand`)
  if (rest) parts.push(three(rest))
  const words = parts.join(' ') || 'Zero'
  return `Rupees ${words}${paise ? ` and ${two(paise)} Paise` : ''} Only`
}

function party(p?: RenderDocumentRequest['seller']): PartyView | undefined {
  if (!p) return undefined
  return {
    name: p.name,
    gstin: p.gstin,
    lines: [p.address, [p.city, p.state, p.pincode].filter(Boolean).join(', '), p.phone, p.email].filter(Boolean) as string[],
  }
}

export async function buildModel(
  type: DocumentType, req: RenderDocumentRequest, totals: Totals, number: string, viewUrl: string, branding: Branding = {}
): Promise<DocModel> {
  const po = type === 'purchase_order'
  return {
    type,
    title: TITLE[type],
    number,
    date: fmtDate(req.date),
    due: req.due_date ? { label: type === 'quotation' ? 'Valid until' : type === 'purchase_order' ? 'Deliver by' : 'Due', date: fmtDate(req.due_date) } : undefined,
    seller: party(req.seller)!,
    buyer: party(req.buyer)!,
    shipTo: party(req.ship_to),
    labels: { from: po ? 'Buyer' : 'From', to: po ? 'Supplier' : type === 'label' ? 'Deliver to' : 'Bill to', ship: 'Ship to' },
    lines: totals.lines.map(l => ({
      description: l.description, hsn: l.hsn, quantity: l.quantity, unit: l.unit,
      rate: l.unit_price, gstRate: l.gst_rate, discount: l.discount, discountPct: l.discount_pct, taxable: l.taxable, total: l.total,
    })),
    showPrices: type !== 'packing_slip' && type !== 'label',
    showTax: type === 'invoice' || type === 'quotation' || type === 'receipt' || type === 'purchase_order',
    totals,
    amountWords: amountInWords(totals.total),
    notes: req.notes,
    terms: req.terms,
    reference: req.reference,
    stamp: type === 'receipt' ? 'PAID' : undefined,
    viewUrl,
    qr: await QRCode.toDataURL(viewUrl, { margin: 0, width: 240 }),
    logo: branding.logo ?? null,
  }
}
