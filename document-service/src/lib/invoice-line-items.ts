import { z } from 'zod'
import { calculateGST, round2 } from './gst'
import { lineItemExGst, lineItemFromMrpIncl } from './pricing'

/**
 * Shared line-item rules for quotations, invoices and cash sales.
 *
 * A line is either a store product (product_id set — goes through inventory when
 * the inventory flag is on) or a CUSTOM line (product_id null — never touches
 * inventory). Rates are per BASE piece: a count unit with factor > 1 (SET of 10)
 * multiplies the quantity before pricing, so 2 × SET @ ₹5/pc = 20 pcs × ₹5.
 */

// order_items.buy_unit is varchar(10); a custom unit is stored there on invoices.
export const CUSTOM_UNIT_MAX = 10
export const GST_MAX = 40

const zOptUuid = z.string().uuid().nullish()
const zGst = z.coerce.number().min(0, 'GST % cannot be negative').max(GST_MAX, `GST % cannot exceed ${GST_MAX}`)
const zDiscount = z.coerce
  .number()
  .min(0, 'Discount cannot be negative')
  .max(100, 'Discount cannot exceed 100%')
  .default(0)
const zQty = z.coerce.number().positive('Quantity must be greater than 0')

/** Count-unit factor that scales quantity → base pieces (1 for custom / non-count lines). */
export function lineFactor(item: {
  product_id?: string | null
  sell_unit_factor?: number | string | null
  sell_unit_dimension?: string | null
}): number {
  if (!item.product_id) return 1
  const f = Number(item.sell_unit_factor) || 1
  if (item.sell_unit_dimension && item.sell_unit_dimension !== 'count') return 1
  return f > 1 ? f : 1
}

function refineCustom(
  item: { product_id?: string | null; variant_id?: string | null; sub_variant_id?: string | null },
  rate: number,
  unit: string | null | undefined,
  ctx: z.RefinementCtx,
  rateKey: string,
  unitKey: string,
  draft = false
) {
  if (item.product_id) return
  if (item.variant_id || item.sub_variant_id)
    ctx.addIssue({ code: 'custom', path: ['product_id'], message: 'A variant needs a store product' })
  if (!draft && !(rate > 0)) ctx.addIssue({ code: 'custom', path: [rateKey], message: 'Rate must be greater than 0' })
  if (unit && unit.trim().length > CUSTOM_UNIT_MAX)
    ctx.addIssue({
      code: 'custom',
      path: [unitKey],
      message: `Unit must be at most ${CUSTOM_UNIT_MAX} characters`,
    })
}

// ── Invoices / orders / cash sales ────────────────────────────────────────────

// A draft keeps half-filled lines: the name may be empty and a custom rate may be 0.
const invoiceLine = (draft: boolean) =>
  z
    .object({
      product_id: zOptUuid,
      variant_id: zOptUuid,
      sub_variant_id: zOptUuid,
      product_name: z.string().trim().min(draft ? 0 : 1, 'Item name is required').max(255),
      product_sku: z.string().nullish(),
      variant_name: z.string().nullish(),
      sub_variant_name: z.string().nullish(),
      hsn_code: z.string().trim().max(20, 'HSN must be at most 20 characters').nullish(),
      gst_rate: zGst.default(18),
      unit_price: z.coerce.number().min(0, 'Rate cannot be negative'),
      quantity: zQty,
      discount_pct: zDiscount,
      sell_unit_factor: z.coerce.number().positive().default(1),
      sell_unit_dimension: z.string().nullish(),
      buy_unit: z.string().trim().max(20).nullish(),
      unit: z.string().trim().nullish(),
      buy_mode: z.string().nullish(),
      temp_id: z.string().nullish(),
      is_custom: z.boolean().nullish(),
    })
    .superRefine((item, ctx) => {
      refineCustom(item, item.unit_price, item.buy_unit || item.unit, ctx, 'unit_price', 'unit', draft)
      if (item.product_id && item.buy_unit && item.buy_unit.length > CUSTOM_UNIT_MAX)
        ctx.addIssue({
          code: 'custom',
          path: ['buy_unit'],
          message: `Unit must be at most ${CUSTOM_UNIT_MAX} characters`,
        })
    })

export const invoiceLineSchema = invoiceLine(false)
export const draftInvoiceLineSchema = invoiceLine(true)

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>

/** Header + lines for invoice drafts / edits (address fields optional on drafts, lines may be half-filled). */
export const draftInvoiceSchema = z.object({
  customerName: z.string({ error: 'Customer name is required' }).trim().min(1, 'Customer name is required'),
  customerPhone: z.string().nullish(),
  customerEmail: z.string().email('Enter a valid email').or(z.literal('')).nullish(),
  addressLine1: z.string().nullish(),
  addressLine2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  postalCode: z.string().nullish(),
  buyerGstin: z.string().nullish(),
  paymentMode: z.string().nullish(),
  invoiceDate: z.string().nullish(),
  notes: z.string().nullish(),
  items: z.array(draftInvoiceLineSchema).default([]),
})

export const editInvoiceSchema = draftInvoiceSchema.extend({
  items: z.array(invoiceLineSchema).min(1, 'Add at least one line item'),
})

export interface PricedInvoiceLine {
  product_id: string | null
  product_name: string
  product_sku: string
  variant_id: string | null
  sub_variant_id: string | null
  variant_name: string | null
  sub_variant_name: string | null
  hsn_code: string | null
  gst_rate: number
  quantity: number
  buy_unit: string | null
  sold_unit: string | null
  buy_mode: string
  sold_unit_factor: number | null
  base_quantity: number | null
  unit_price: number
  mrp: number
  discount_pct: number
  discount_amount: number
  total_price: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  tax_amount: number
  temp_id: string | null
  is_custom: boolean
}

export interface PricedInvoice {
  lines: PricedInvoiceLine[]
  subtotal: number
  taxAmount: number
  totalAmount: number
  totalTaxable: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
}

/**
 * Price invoice lines from an MRP-incl-GST per-piece `unit_price`. GST off ⇒ the
 * ex-GST equivalent is charged and tax columns are zero (same rule everywhere).
 */
export function priceInvoiceLines(
  items: InvoiceLineInput[],
  opts: { gstEnabled: boolean; orderIsIgst: boolean }
): PricedInvoice {
  let subtotal = 0
  let totalTaxable = 0
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0

  const lines = items.map((item): PricedInvoiceLine => {
    const isCustom = !item.product_id
    const unitPrice = Number(item.unit_price) || 0
    const qty = Number(item.quantity) || 0
    const factor = lineFactor(item)
    const baseQty = qty * factor
    const discPct = Number(item.discount_pct) || 0
    const gstRate = Number(item.gst_rate ?? 18)
    const unit = isCustom ? (item.buy_unit || item.unit || 'PCS').trim().toUpperCase() : item.buy_unit || null
    const base = {
      product_id: item.product_id || null,
      product_name: item.product_name,
      product_sku: isCustom ? '' : item.product_sku || '',
      variant_id: isCustom ? null : item.variant_id || null,
      sub_variant_id: isCustom ? null : item.sub_variant_id || null,
      variant_name: isCustom ? null : item.variant_name || null,
      sub_variant_name: isCustom ? null : item.sub_variant_name || null,
      hsn_code: item.hsn_code || null,
      quantity: qty,
      buy_unit: unit,
      sold_unit: unit,
      buy_mode: item.buy_mode || 'unit',
      sold_unit_factor: factor > 1 ? factor : null,
      base_quantity: factor > 1 ? baseQty : null,
      unit_price: unitPrice,
      mrp: unitPrice,
      discount_pct: discPct,
      temp_id: item.temp_id || null,
      is_custom: isCustom,
    }

    if (!opts.gstEnabled) {
      const exUnit = gstRate > 0 ? unitPrice / (1 + gstRate / 100) : unitPrice
      const lineTotal = round2(lineItemExGst(baseQty, exUnit, discPct))
      subtotal += lineTotal
      return {
        ...base,
        gst_rate: 0,
        discount_amount: discPct > 0 ? round2(baseQty * exUnit * (discPct / 100)) : 0,
        total_price: lineTotal,
        taxable_amount: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        tax_amount: 0,
      }
    }

    const lineTotal = round2(lineItemFromMrpIncl(baseQty, unitPrice, discPct, gstRate))
    const gst = calculateGST(lineTotal, gstRate, opts.orderIsIgst)
    subtotal += lineTotal
    totalTaxable += gst.taxableAmount
    totalCgst += gst.cgst
    totalSgst += gst.sgst
    totalIgst += gst.igst
    return {
      ...base,
      gst_rate: gstRate,
      discount_amount: discPct > 0 ? round2(((baseQty * unitPrice) / (1 + gstRate / 100)) * (discPct / 100)) : 0,
      total_price: lineTotal,
      taxable_amount: round2(gst.taxableAmount),
      cgst_amount: round2(gst.cgst),
      sgst_amount: round2(gst.sgst),
      igst_amount: round2(gst.igst),
      tax_amount: round2(gst.cgst + gst.sgst + gst.igst),
    }
  })

  return {
    lines,
    subtotal,
    taxAmount: round2(totalCgst + totalSgst + totalIgst),
    totalAmount: round2(subtotal),
    totalTaxable,
    totalCgst,
    totalSgst,
    totalIgst,
  }
}

// ── Quotations ────────────────────────────────────────────────────────────────

const quotationLine = (draft: boolean) =>
  z
    .object({
      description: z.string().trim().min(draft ? 0 : 1, 'Item name is required'),
      quantity: zQty,
      rate: z.coerce.number().min(0, 'Rate cannot be negative'),
      hsn_code: z.string().trim().max(20, 'HSN must be at most 20 characters').nullish(),
      gst_rate: zGst.default(18),
      unit: z.string().trim().max(20, 'Unit must be at most 20 characters').default('PCS'),
      buy_unit: z.string().trim().max(20).nullish(),
      discount_pct: zDiscount,
      product_id: zOptUuid,
      variant_id: zOptUuid,
      sub_variant_id: zOptUuid,
      variant_name: z.string().nullish(),
      sub_variant_name: z.string().nullish(),
      sell_unit_factor: z.coerce.number().positive().nullish(),
      sell_unit_dimension: z.string().nullish(),
      is_custom: z.boolean().nullish(),
    })
    .superRefine((item, ctx) => refineCustom(item, item.rate, item.unit, ctx, 'rate', 'unit', draft))

export const quotationLineSchema = quotationLine(false)
export const draftQuotationLineSchema = quotationLine(true)

export type QuotationLineInput = z.infer<typeof quotationLineSchema>

/**
 * Lines stored while a document was a draft may be half-filled. Before it is finalised, each custom
 * line needs a name and a rate: returns "Item N: …" for the first that doesn't, else null.
 */
type StoredLine = { product_id?: string | null; name: string | null; rate: number | string | null }

export function incompleteLineError(lines: StoredLine[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!(l.name ?? '').trim()) return `Item ${i + 1}: Enter an item name`
    if (!l.product_id && !(Number(l.rate) > 0)) return `Item ${i + 1}: Enter a rate greater than 0`
  }
  return null
}

export class IncompleteLinesError extends Error {}

/** Throws IncompleteLinesError (→ 400) inside a transaction when a stored line is half-filled. */
export function assertCompleteLines(lines: StoredLine[]): void {
  const msg = incompleteLineError(lines)
  if (msg) throw new IncompleteLinesError(msg)
}

/** Ex-GST line amount. `rate` is per base piece, so count units scale by factor. */
export function quotationLineAmount(item: QuotationLineInput): number {
  return lineItemExGst(Number(item.quantity) * lineFactor(item), Number(item.rate), Number(item.discount_pct) || 0)
}

/** Row values for quotation_items (factor/base qty only on store-product count lines). */
export function quotationLineRow(item: QuotationLineInput, gstEnabled: boolean) {
  const isCustom = !item.product_id
  const factor = lineFactor(item)
  return {
    description: item.description,
    hsn_code: item.hsn_code || null,
    gst_rate: gstEnabled ? Number(item.gst_rate ?? 18) : 0,
    quantity: Number(item.quantity),
    unit: (item.unit || 'PCS').toUpperCase(),
    buy_unit: isCustom ? null : item.buy_unit || null,
    sold_unit_factor: factor > 1 ? factor : null,
    base_quantity: factor > 1 ? Number(item.quantity) * factor : null,
    rate: Number(item.rate),
    discount_pct: Number(item.discount_pct) || 0,
    amount: quotationLineAmount(item),
    product_id: item.product_id || null,
    variant_id: isCustom ? null : item.variant_id || null,
    sub_variant_id: isCustom ? null : item.sub_variant_id || null,
    variant_name: isCustom ? null : item.variant_name || null,
    sub_variant_name: isCustom ? null : item.sub_variant_name || null,
  }
}

export function quotationTotals(items: { amount: number; gst_rate: number }[]) {
  const subtotal = items.reduce((s, i) => s + Number(i.amount), 0)
  const cgst = items.reduce((s, i) => s + (Number(i.amount) * Number(i.gst_rate)) / 200, 0)
  return { subtotal, cgst_amount: cgst, sgst_amount: cgst, total_amount: round2(subtotal + 2 * cgst) }
}

/** Persist one quotation_items row on the caller's client (transaction). */
export async function insertQuotationItem(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  quotationId: string,
  position: number,
  r: ReturnType<typeof quotationLineRow>
) {
  await client.query(
    `INSERT INTO quotation_items (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, buy_unit,
       sold_unit_factor, base_quantity, rate, discount_pct, amount, product_id, variant_id, sub_variant_id,
       variant_name, sub_variant_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      quotationId,
      position,
      r.description,
      r.hsn_code,
      r.gst_rate,
      r.quantity,
      r.unit,
      r.buy_unit,
      r.sold_unit_factor,
      r.base_quantity,
      r.rate,
      r.discount_pct,
      r.amount,
      r.product_id,
      r.variant_id,
      r.sub_variant_id,
      r.variant_name,
      r.sub_variant_name,
    ]
  )
}

// ── Stock shortfall messages ──────────────────────────────────────────────────

export interface Shortfall {
  label: string
  unit: string | null
  factor: number
  required_base: number
  available_base: number
  short_base: number
}

const n3 = (v: number) => String(Math.round(v * 1000) / 1000)

/** "Widget — need 2 SET (20 pcs), available 15 pcs, short 5 pcs (0.5 SET)". */
export function formatShortfall(s: Shortfall): string {
  const unit = (s.unit || '').toUpperCase()
  const inUnits = s.factor > 1 && unit
  const need = inUnits
    ? `${n3(s.required_base / s.factor)} ${unit} (${n3(s.required_base)} pcs)`
    : `${n3(s.required_base)} pcs`
  const short = inUnits ? `${n3(s.short_base)} pcs (${n3(s.short_base / s.factor)} ${unit})` : `${n3(s.short_base)} pcs`
  return `${s.label} — need ${need}, available ${n3(s.available_base)} pcs, short ${short}`
}

export function buildShortfall(
  label: string,
  unit: string | null,
  factor: number,
  requiredBase: number,
  availableBase: number
): Shortfall | null {
  if (availableBase + 1e-6 >= requiredBase) return null
  return {
    label,
    unit,
    factor: factor > 1 ? factor : 1,
    required_base: requiredBase,
    available_base: availableBase,
    short_base: Math.max(0, requiredBase - availableBase),
  }
}
