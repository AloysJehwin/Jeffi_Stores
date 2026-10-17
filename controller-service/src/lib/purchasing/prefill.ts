// Seed lines for the New PO form (duplicate a PO, or draft from reorder suggestions).
// Quantities on the form are in purchase units; stored PO quantities are base units.

export interface PrefillLine {
  product_id: string
  variant_id: string
  sub_variant_id: string
  product_name: string
  sku: string
  quantity: string
  tax_rate: string
  hsn_code: string
  mrp: number
  sell_unit_label: string
  sell_unit_dimension: string
  purchase_unit: string
  purchase_unit_factor: string
  line_total_incl_gst: string
  gst_inclusive: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const num = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const str = (v: unknown) => (v == null ? '' : String(v))

/** `pid:vid:svid:qty,...` (empty ids allowed, qty in base units), capped at 50 lines. */
export function parsePrefillLines(raw: string | null | undefined) {
  if (!raw) return []
  const out: { product_id: string; variant_id: string | null; sub_variant_id: string | null; quantity: number }[] = []
  for (const part of raw.split(',').slice(0, 50)) {
    const [pid, vid, svid, qty] = part.split(':')
    if (!pid || !UUID.test(pid)) continue
    if ((vid && !UUID.test(vid)) || (svid && !UUID.test(svid))) continue
    const q = num(qty)
    if (q <= 0) continue
    out.push({ product_id: pid, variant_id: vid || null, sub_variant_id: svid || null, quantity: q })
  }
  return out
}

/** A copy of an existing PO line: same purchase unit, quantity and price. */
export function duplicateLine(it: Record<string, unknown>): PrefillLine {
  const factor = num(it.purchase_unit_factor) || 1
  const tax = num(it.tax_rate)
  const stored = it.line_total_incl_gst == null ? null : num(it.line_total_incl_gst)
  // Older lines have no entered total: total_cost already includes tax.
  const inclusive = stored == null ? true : it.gst_inclusive !== false
  return {
    product_id: str(it.product_id),
    variant_id: str(it.variant_id),
    sub_variant_id: str(it.sub_variant_id),
    product_name: str(it.product_name),
    sku: str(it.sku),
    quantity: String(r3(num(it.quantity) / factor)),
    tax_rate: String(Math.round(tax)),
    hsn_code: str(it.hsn_code),
    mrp: num(it.mrp),
    sell_unit_label: str(it.sell_unit_label),
    sell_unit_dimension: str(it.sell_unit_dimension),
    purchase_unit: str(it.purchase_unit),
    purchase_unit_factor: String(factor),
    line_total_incl_gst: String(r2(stored ?? num(it.total_cost))),
    gst_inclusive: inclusive,
  }
}

/** A new line for a catalogue leaf; priced from the supplier's last buy price when there is one. */
export function reorderLine(
  leaf: Record<string, unknown>,
  supplierPrice: Record<string, unknown> | null,
  baseQty: number
): PrefillLine {
  const factor = num(supplierPrice?.purchase_unit_factor) || 1
  const qtyPu = Math.max(1, Math.ceil(r3(baseQty / factor)))
  const tax = num(leaf.gst)
  const names = [leaf.variant_name, leaf.sub_variant_name].filter(Boolean).join(' / ')
  // product_suppliers.unit_cost is per base unit, ex GST unless flagged inclusive.
  const cost = num(supplierPrice?.unit_cost)
  const exGst = supplierPrice?.gst_inclusive ? cost / (1 + tax / 100) : cost
  const total = cost > 0 ? r2(exGst * qtyPu * factor * (1 + tax / 100)) : 0
  return {
    product_id: str(leaf.product_id),
    variant_id: str(leaf.variant_id),
    sub_variant_id: str(leaf.sub_variant_id),
    product_name: names ? `${leaf.name} — ${names}` : str(leaf.name),
    sku: str(leaf.sku),
    quantity: String(qtyPu),
    tax_rate: String(Math.round(tax)),
    hsn_code: str(leaf.hsn_code),
    mrp: num(leaf.mrp),
    sell_unit_label: str(leaf.sell_unit_label),
    sell_unit_dimension: str(leaf.sell_unit_dimension),
    purchase_unit: str(supplierPrice?.purchase_unit),
    purchase_unit_factor: String(factor),
    line_total_incl_gst: total ? String(total) : '',
    gst_inclusive: true,
  }
}
