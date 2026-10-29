import type { ChangeItem, ChangePart } from '@/lib/admin/change-log'

// How change-log fields read: a label per column, and each value as a badge, money, a date or text.
// Server-safe (the assistant's tool uses it too); the components map a status domain to its badges.

export const humanize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '-')

export type StatusDomain = 'order' | 'payment' | 'shipment' | 'invoice' | 'quotation'

export const KIND_NOUN: Record<string, string> = {
  order: 'order',
  invoice: 'invoice',
  cash_sale: 'bill',
  quotation: 'quotation',
  product: 'product',
  customer: 'customer',
  business_customer: 'account',
  rfq: 'RFQ',
  subscription: 'subscription',
  coupon: 'coupon',
  offer: 'offer',
  brand: 'brand',
  category: 'category',
  supplier: 'supplier',
  review_form: 'form',
  campaign: 'campaign',
  email_campaign: 'campaign',
  payable: 'bill',
  purchase_order: 'purchase order',
  grn: 'GRN',
}

const LABELS: Record<string, string> = {
  awb_number: 'AWB number',
  upi: 'UPI',
  ifsc: 'IFSC',
  pan: 'PAN',
  gstin: 'GSTIN',
  irn_status: 'E-invoice status',
  eway_bill_no: 'E-way bill',
  mrp: 'MRP',
  sku: 'SKU',
  hsn_code: 'HSN code',
  gst_rate: 'GST rate',
  gst_number: 'GSTIN',
  buyer_gstin: 'Buyer GSTIN',
  consignee_gstin: 'Consignee GSTIN',
  cod_fee_amount: 'COD fee',
  shipping_address_snapshot: 'Shipping address',
  billing_address_snapshot: 'Billing address',
  is_active: 'Active',
  unit_price_paise: 'Unit price',
  unit_price_ex_gst: 'Unit price (ex GST)',
  shipping_paise: 'Shipping',
  pdf_url: 'PDF',
  payment_link_status: 'Payment link',
  estimated_delivery_date: 'Estimated delivery',
  discount_pct: 'Discount',
  stock_quantity: 'Stock',
  selling_price: 'Selling price',
  interval_count: 'Every',
  access_revoked_at: 'Access revoked',
  consignee_addr1: 'Consignee address',
  consignee_addr2: 'Consignee address 2',
  buyer_addr1: 'Buyer address',
  buyer_addr2: 'Buyer address 2',
  converted_order_id: 'Converted to order',
  converted_quotation_id: 'Converted to quotation',
  reviewed_by: 'Reviewed by',
}

export function fieldLabel(field: string): string {
  return LABELS[field] ?? humanize(field.replace(/_id$/, ''))
}

function statusDomain(entityType: string, field: string): StatusDomain | undefined {
  if (field === 'payment_status') return 'payment'
  if (field === 'shipment_status') return 'shipment'
  if (field !== 'status') return undefined
  if (entityType === 'orders' || entityType === 'order') return 'order'
  if (entityType === 'invoices' || entityType === 'invoice') return 'invoice'
  if (entityType === 'quotations' || entityType === 'quotation') return 'quotation'
  return undefined
}

export type ShownValue =
  | { kind: 'empty' }
  | { kind: 'status'; status: string; domain?: StatusDomain }
  | { kind: 'image'; url: string }
  | { kind: 'link'; url: string; text: string }
  | { kind: 'text'; text: string; full?: string }

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const MONEY = /(^|_)(amount|price|mrp|total|subtotal|rate|fee|cost|credit_limit|value)$/
const DATE_ONLY = /^\d{4}-\d\d-\d\d$/

export function formatWhen(iso: string, dateOnly = false): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
  })
}

function address(v: Record<string, any>): string | null {
  const parts = [
    v.name || v.full_name,
    v.address_line1 ?? v.line1 ?? v.address1,
    v.address_line2 ?? v.line2,
    v.city,
    v.state,
    v.pincode ?? v.postal_code,
  ].filter(x => typeof x === 'string' && x.trim())
  return parts.length ? parts.join(', ') : null
}

export function showValue(entityType: string, field: string, value: unknown, label?: string): ShownValue {
  if (value === null || value === undefined || value === '') return { kind: 'empty' }
  if (label) return { kind: 'text', text: label }
  const domain = statusDomain(entityType, field)
  if (domain || /(^|_)status$/.test(field)) return { kind: 'status', status: String(value), domain }
  if (typeof value === 'boolean') return { kind: 'text', text: value ? 'Yes' : 'No' }
  if (typeof value === 'object') {
    if (Array.isArray(value)) return { kind: 'text', text: `${value.length} item${value.length === 1 ? '' : 's'}`, full: JSON.stringify(value, null, 2) }
    const addr = /address/.test(field) ? address(value as Record<string, any>) : null
    return addr ? { kind: 'text', text: addr } : { kind: 'text', text: 'changed', full: JSON.stringify(value, null, 2) }
  }
  const s = String(value)
  if (/image_url|thumbnail|^image$/.test(field) && /^https?:\/\//.test(s)) return { kind: 'image', url: s }
  if (/(_url|^url)$/.test(field) && /^https?:\/\//.test(s)) return { kind: 'link', url: s, text: field === 'pdf_url' ? 'PDF' : 'link' }
  const n = typeof value === 'number' ? value : Number(s)
  if (field === 'gst_rate' || field === 'discount_pct' || field.endsWith('_percent')) {
    return { kind: 'text', text: Number.isFinite(n) ? `${n}%` : s }
  }
  if (field.endsWith('_paise') && Number.isFinite(n)) return { kind: 'text', text: money(n / 100) }
  if (MONEY.test(field) && Number.isFinite(n) && s.trim() !== '') return { kind: 'text', text: money(n) }
  if (/(_at|_date|^valid_from|^valid_until)$/.test(field) && !Number.isNaN(Date.parse(s))) {
    return { kind: 'text', text: formatWhen(s, DATE_ONLY.test(s) || field.endsWith('_date')) }
  }
  if (/_id$|^reviewed_by$/.test(field) && /^[0-9a-f-]{36}$/i.test(s)) return { kind: 'text', text: `#${s.slice(0, 8)}` }
  return s.length > 90 ? { kind: 'text', text: `${s.slice(0, 90)}…`, full: s } : { kind: 'text', text: s }
}

/** "Status and Payment status", "Price, Stock and 3 more". */
export function fieldList(fields: string[]): string {
  // Lower-case the first letter, but not an acronym's ("AWB number").
  const labels = fields.map(f => fieldLabel(f)).map(l => (/^[A-Z]{2}/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1)))
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length <= 3) return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  return formatWhen(iso, true)
}

export const VERB: Record<string, string> = { create: 'added', delete: 'removed', update: 'changed' }

function childPhrase(parts: ChangePart[]): string[] {
  const groups = new Map<string, ChangePart[]>()
  for (const p of parts) {
    const key = `${VERB[p.action] ?? 'changed'}|${p.child!.label}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.entries()].map(([key, ps]) => {
    const [verb, label] = key.split('|')
    if (ps.length > 1) return `${verb} ${ps.length} ${label.toLowerCase()}s`
    const name = ps[0].child!.name
    return `${verb} ${label.toLowerCase()}${name ? ` “${name}”` : ''}`
  })
}

/** "changed status and payment status", "created this order, added 3 items". */
export function headline(item: ChangeItem, noun: string): string {
  if (item.summary) return item.summary
  const parent = item.parts.find(p => !p.child)
  const bits: string[] = []
  if (parent) {
    if (parent.action === 'create') bits.push(`created this ${noun}`)
    else if (parent.action === 'delete') bits.push(`deleted this ${noun}`)
    else if (parent.changes.length === 1 && parent.changes[0].field === 'is_active')
      bits.push(`${parent.changes[0].to ? 'activated' : 'deactivated'} this ${noun}`)
    else if (parent.changes.length) bits.push(`changed ${fieldList(parent.changes.map(c => c.field))}`)
    else bits.push(`updated this ${noun}`)
  }
  bits.push(...childPhrase(item.parts.filter(p => p.child)))
  return bits.join(', ')
}

export function textOf(v: ShownValue): string {
  if (v.kind === 'empty') return '—'
  if (v.kind === 'status') return humanize(v.status)
  if (v.kind === 'image') return 'new image'
  return v.text
}
