import { queryMany } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { buildAttributeFilterClauses } from '@/lib/catalog/product-attribute-filters'
import { buildProductSearchClause } from '@/lib/catalog/search'
import { ALL_DIMENSIONS, UNITS, type Dimension } from '@/lib/catalog/units'
import type { ToolDef, ToolInputSchema } from '../tools'
import { ok } from '../tool-envelope'

// Bulk product changes as the admin Controls page makes them: its filters, operations and value rules.
// On approval they run through /api/admin/controls, so each lands in Controls → History with its
// before-values and can be undone there or with propose_rollback_bulk_update.

/** Most products one proposal may change; bigger sets go through the Controls page. */
export const BULK_MAX = 200

type ValueKind = 'percent' | 'discount' | 'money' | 'whole' | 'choice' | 'text' | 'country' | 'flag' | 'unit'

interface BulkOp {
  label: string
  kind: ValueKind
  /** products column the operation writes; 'price' = the MRP / discount / selling price group. */
  field: string
  options?: Record<string, string>
  max?: number
  unit?: string
}

const flagLabels = (yes: string, no: string) => ({ true: yes, false: no })

// Labels and options as on the Controls page; text limits are the column sizes. set_images is left out:
// it needs an uploaded or gallery image.
export const BULK_OPERATIONS: Record<string, BulkOp> = {
  inflate_price: { label: 'Inflate Price', kind: 'percent', field: 'price' },
  set_discount: { label: 'Set Discount %', kind: 'discount', field: 'price' },
  set_mrp_ex_gst: { label: 'Set MRP (Ex-GST)', kind: 'money', field: 'price' },
  set_tax_class: {
    label: 'Set Tax Class',
    kind: 'choice',
    field: 'tax_class',
    options: { standard: 'Standard', reduced: 'Reduced', zero: 'Zero', exempt: 'Exempt' },
  },
  set_condition: {
    label: 'Set Condition',
    kind: 'choice',
    field: 'condition',
    options: { new: 'New', used: 'Used', refurbished: 'Refurbished' },
  },
  set_shipping_class: {
    label: 'Set Shipping Class',
    kind: 'choice',
    field: 'shipping_class',
    options: { standard: 'Standard', express: 'Express', freight: 'Freight' },
  },
  set_handling_days: { label: 'Set Handling Days', kind: 'whole', field: 'handling_days', unit: 'days' },
  set_warranty_months: { label: 'Set Warranty Months', kind: 'whole', field: 'warranty_months', unit: 'months' },
  set_target_gender: {
    label: 'Set Target Gender',
    kind: 'choice',
    field: 'target_gender',
    options: { unisex: 'Unisex', male: 'Male', female: 'Female' },
  },
  set_grade: { label: 'Set Grade', kind: 'text', field: 'grade', max: 50 },
  set_hsn_code: { label: 'Set HSN Code', kind: 'text', field: 'hsn_code', max: 20 },
  set_country_of_origin: { label: 'Set Country of Origin', kind: 'country', field: 'country_of_origin' },
  set_featured: { label: 'Set Featured', kind: 'flag', field: 'is_featured', options: flagLabels('Featured', 'Not featured') },
  set_searchable: {
    label: 'Set Searchable',
    kind: 'flag',
    field: 'is_searchable',
    options: flagLabels('Searchable', 'Hidden from search'),
  },
  set_active: { label: 'Set Active/Inactive', kind: 'flag', field: 'is_active', options: flagLabels('Active', 'Inactive (delisted)') },
  set_selling_unit: { label: 'Set Selling Unit', kind: 'unit', field: 'selling_unit' },
}

const OPERATION_KEYS = Object.keys(BULK_OPERATIONS)

type Row = Record<string, any>
type SellingUnit = {
  unit: string
  factor: number
  dimension: Dimension
  display_label: string | null
  min_qty: number
  max_qty: number | null
  qty_step: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const text = (v: unknown) =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
const inr = (n: number) => `₹${n.toFixed(2)}`
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const operationOf = (op: string) => (Object.hasOwn(BULK_OPERATIONS, op) ? BULK_OPERATIONS[op] : null)

export function operationLabel(op: string): string {
  return operationOf(op)?.label ?? (op === 'set_images' ? 'Replace Images' : op)
}

function unknownOperation(op: string): string {
  return `Unknown operation "${op}". Use one of: ${OPERATION_KEYS.join(', ')}.${
    op === 'set_images' ? ' Replacing images needs an image upload, so it is only on the Controls page.' : ''
  }`
}

// Rupee signs, commas and % are dropped; anything else that isn't a plain number is NaN.
function num(v: unknown): number {
  const s = text(v).replace(/[₹,%\s]/g, '').replace(/^\+/, '')
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN
}

function flag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const s = text(v).toLowerCase()
  if (['true', 'yes', 'on', '1', 'active'].includes(s)) return true
  if (['false', 'no', 'off', '0', 'inactive'].includes(s)) return false
  return null
}

function list(v: unknown, sep: RegExp): string[] {
  const parts = Array.isArray(v) ? v.map(text) : typeof v === 'string' ? v.split(sep).map(s => s.trim()) : []
  return [...new Set(parts.filter(Boolean))]
}

/** The Controls page's display of a logged or proposed value. */
export function valueLabel(operation: string, value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (v.unit) return `${v.unit}${v.factor ? ` (×${v.factor})` : ''}`
    return v.slot != null ? `image #${v.slot}` : ''
  }
  const s = String(value)
  const op = operationOf(operation)
  if (!op) return s
  if (op.kind === 'percent') return `+${s}%`
  if (op.kind === 'discount') return `${s}%`
  if (op.kind === 'money') return Number.isFinite(Number(s)) ? inr(Number(s)) : s
  if (op.options && Object.hasOwn(op.options, s)) return op.options[s]
  return op.unit ? `${s} ${op.unit}` : s
}

// ── value rules (the Controls page's inputs plus the API's checks) ─────────────

const SI_BASE: Record<Dimension, string> = { count: 'pcs', length: 'm', area: 'm²', volume: 'L', weight: 'kg', custom: 'base units' }

function sellingUnit(raw: unknown): SellingUnit {
  let o: unknown = raw
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o)
    } catch {
      o = { unit: o }
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    throw new Error('set_selling_unit needs selling_unit: { unit, factor, dimension, display_label, min_qty, max_qty, qty_step }.')
  }
  const u = o as Record<string, unknown>
  const dimension = (text(u.dimension).toLowerCase() || 'count') as Dimension
  if (!ALL_DIMENSIONS.includes(dimension)) throw new Error(`selling_unit.dimension must be one of ${ALL_DIMENSIONS.join(', ')}.`)
  const name = text(u.unit)
  if (!name || name.length > 20) throw new Error('selling_unit.unit is required (up to 20 characters), e.g. box.')
  const defs = UNITS[dimension]
  const def = defs.find(d => d.key === name) ?? defs.find(d => d.key.toLowerCase() === name.toLowerCase())
  // The page locks the factor of standard units (dozen = 12, ft = 0.3048 m, ...).
  const fixed = dimension === 'count' ? def?.multiplier : def?.toSi
  const given = u.factor == null || u.factor === '' ? null : num(u.factor)
  if (fixed != null && given != null && given !== fixed) throw new Error(`The factor of ${def!.key} is fixed at ${fixed}; leave factor out.`)
  const factor = fixed ?? given
  if (factor == null || !(factor > 0)) {
    throw new Error(
      dimension === 'count'
        ? `selling_unit.factor is required: pieces per ${name}, above 0.`
        : `selling_unit.factor is required: how many ${SI_BASE[dimension]} one ${name} is, above 0.`
    )
  }
  const positive = (k: string, fallback: number | null) => {
    if (u[k] == null || u[k] === '') return fallback
    const v = num(u[k])
    if (!(v > 0)) throw new Error(`selling_unit.${k} must be above 0.`)
    return v
  }
  const min_qty = positive('min_qty', 1) as number
  const max_qty = positive('max_qty', null)
  if (max_qty != null && max_qty < min_qty) throw new Error('selling_unit.max_qty must be at least min_qty.')
  const display_label = text(u.display_label) || null
  if (display_label && display_label.length > 80) throw new Error('selling_unit.display_label is up to 80 characters.')
  return {
    unit: def?.key ?? name,
    factor,
    dimension,
    display_label,
    min_qty,
    max_qty,
    // Count units step in whole pieces (locked to 1 on the page).
    qty_step: dimension === 'count' ? 1 : (positive('qty_step', 1) as number),
  }
}

/** The value the Controls page would send; throws where the page or its API would refuse it. */
function bulkValue(op: BulkOp, input: Record<string, unknown>): string | SellingUnit {
  if (op.kind === 'unit') return sellingUnit(input.selling_unit ?? input.value)
  const raw = input.value
  if (raw == null || text(raw) === '') throw new Error(`${op.label} needs a value.`)
  const n = num(raw)
  switch (op.kind) {
    case 'percent':
      if (!(n > 0)) throw new Error(`${op.label} needs a percentage above 0, e.g. 10 for +10%.`)
      return String(n)
    case 'discount':
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Discount must be a percentage from 0 to 100.')
      return String(n)
    case 'money':
      if (!(n > 0) || n >= 1e10) throw new Error('MRP (Ex-GST) must be an amount above 0.')
      return String(n)
    case 'whole':
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) throw new Error(`${op.label} needs a whole number of ${op.unit}, 0 or more.`)
      return String(n)
    case 'choice': {
      const v = text(raw).toLowerCase()
      if (!Object.hasOwn(op.options!, v)) throw new Error(`${op.label} must be one of: ${Object.keys(op.options!).join(', ')}.`)
      return v
    }
    case 'text': {
      const v = text(raw)
      if (v.length > op.max!) throw new Error(`${op.label} is up to ${op.max} characters.`)
      return v
    }
    case 'country': {
      const v = text(raw).toUpperCase()
      if (!/^[A-Z]{2}$/.test(v)) throw new Error('Country of origin must be a 2-letter code, e.g. IN.')
      return v
    }
    default: {
      // flag: the API applies value === 'true', so booleans go as the strings 'true' / 'false'.
      const v = flag(raw)
      if (v === null) throw new Error(`${op.label} needs true or false.`)
      return String(v)
    }
  }
}

// ── targets (the Controls GET's filters, plus exact names / ids) ─────────────

const TARGET_PROPS: ToolInputSchema['properties'] = {
  product_ids: { type: 'array', description: 'Product UUIDs.' },
  product_names: {
    type: 'array',
    description: 'Exact product names or SKUs (case-insensitive). Names that match no product, or several, are reported, never guessed.',
  },
  search: { type: 'string', description: 'Name / SKU search, as the Controls search box.' },
  category: { type: 'string', description: 'Category id or name; its direct subcategories are included.' },
  brand: { type: 'string', description: 'Brand id or name.' },
  attributes: {
    type: 'object',
    description:
      'Attribute filters as on the Controls page, e.g. {"grade":"12.9","condition":"new|used","spec.thread_size":"M8"}. Keys: grade, material, finish, color, size, condition, shipping_class, tax_class, gst_percentage, hsn_code, country_of_origin, target_gender, brand_part_number, supplier, sell_unit, is_featured / is_searchable / has_variants / is_digital / inventory_sync ("true"|"false"), price_min / price_max, mrp_min / mrp_max, discount_min / discount_max, stock_min / stock_max (units on hand), weight_min / weight_max, handling_min / handling_max, warranty_min / warranty_max, created_from / created_to (YYYY-MM-DD), spec.<key> for technical specifications. Several values: pipe-separated or an array.',
  },
  status: {
    type: 'string',
    enum: ['active', 'inactive', 'any'],
    description: 'Product status. Default active; any when product_ids or product_names are given.',
  },
  stock: { type: 'string', enum: ['low', 'out'], description: 'Stock status: Low Stock or Out of Stock.' },
}

// Keys that are targets in their own right when they turn up inside attributes.
const LIFTED = new Set(['search', 'status', 'is_active', 'stock', 'category', 'category_id', 'brand', 'brand_id', 'product_ids', 'product_names'])

function attributesOf(v: unknown): Record<string, string | string[]> {
  let o = v
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o)
    } catch {
      return {}
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
  const out: Record<string, string | string[]> = {}
  for (const [k, raw] of Object.entries(o as Record<string, unknown>).slice(0, 40)) {
    const key = k.trim()
    if (!key || key.length > 100) continue
    const val = Array.isArray(raw) ? raw.map(text).filter(Boolean) : text(raw)
    if (val.length) out[key] = val
  }
  return out
}

function statusOf(v: unknown): 'active' | 'inactive' | 'any' | null {
  const s = text(v).toLowerCase()
  if (s === 'any' || s === 'all' || s === 'both') return 'any'
  const f = flag(s)
  return f === true ? 'active' : f === false ? 'inactive' : null
}

function stockOf(v: unknown): 'low' | 'out' | null {
  const s = text(v).toLowerCase()
  return s.startsWith('low') ? 'low' : s.startsWith('out') ? 'out' : null
}

async function resolveRef(table: 'brands' | 'categories', raw: string): Promise<{ id: string; name: string }> {
  const noun = table === 'brands' ? 'brand' : 'category'
  let rows = await queryMany<{ id: string; name: string }>(
    UUID_RE.test(raw)
      ? `SELECT id::text, name FROM ${table} WHERE id = $1::uuid`
      : `SELECT id::text, name FROM ${table} WHERE lower(btrim(name)) = lower($1) OR slug = lower($1) ORDER BY name LIMIT 6`,
    [raw]
  )
  if (!rows.length && !UUID_RE.test(raw)) {
    rows = await queryMany<{ id: string; name: string }>(
      `SELECT id::text, name FROM ${table} WHERE strpos(lower(name), lower($1)) > 0 ORDER BY name LIMIT 6`,
      [raw]
    )
  }
  if (rows.length === 1) return rows[0]
  if (!rows.length) throw new Error(`No ${noun} matches "${raw}".`)
  throw new Error(
    `"${raw}" matches several ${table}: ${rows.map(r => `${r.name} (${r.id})`).join(', ')}. Pass the ${noun} id.`
  )
}

const PRICE_COLS = `p.has_variants, p.mrp_ex_gst::float8 AS mrp_ex_gst, p.discount_pct::float8 AS discount_pct,
       p.base_price::float8 AS price, p.gst_percentage::float8 AS gst_pct,
       CASE WHEN p.has_variants THEN (SELECT MIN(pv.mrp_ex_gst) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true)::float8 END AS variant_mrp_min,
       CASE WHEN p.has_variants THEN (SELECT MAX(pv.mrp_ex_gst) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true)::float8 END AS variant_mrp_max`

// The current values an operation changes.
function columns(operation: string | null, status: string): { select: string; join: string } {
  const op = operation ? operationOf(operation) : null
  const active = status !== 'active' && op?.field !== 'is_active' ? ', p.is_active' : ''
  if (!op) {
    return {
      select: 'p.mrp_ex_gst::float8 AS mrp_ex_gst, p.discount_pct::float8 AS discount_pct, p.base_price::float8 AS price, p.is_active',
      join: '',
    }
  }
  if (op.field === 'price') return { select: PRICE_COLS + active, join: '' }
  if (op.kind === 'unit') {
    return {
      select: `p.has_variants, pu.unit, pu.factor::float8 AS factor${active}`,
      join: 'LEFT JOIN product_units pu ON pu.product_id = p.id AND pu.is_base = true AND pu.variant_id IS NULL',
    }
  }
  return { select: `p.${op.field}${active}`, join: '' }
}

interface Targets {
  rows: Row[]
  total: number
  /** Listed products the other filters left out. */
  leftOut: number
  missingIds: string[]
  unmatchedNames: string[]
  ambiguousNames: { name: string; matches: { id: string; name: string; sku: string | null }[] }[]
  /** Attribute keys the filter builder can't use (unknown key or unusable value). */
  ignoredAttributes: string[]
  /** At least one filter that narrows the catalog, or an explicit list. */
  narrowed: boolean
  filters: string[]
}

/** The Controls GET's query (same conditions, same helpers), capped, with the full count. */
async function resolveTargets(input: Record<string, unknown>, operation: string | null, limit: number): Promise<Targets> {
  const attrs = attributesOf(input.attributes)
  // Arrays go pipe-joined like the page's (multi-choice keys read only one string), and the builder
  // silently skips unknown keys and unusable values, so those are caught here instead.
  const attrOnly: Record<string, string> = {}
  const ignoredAttributes: string[] = []
  for (const [k, v] of Object.entries(attrs)) {
    if (LIFTED.has(k)) continue
    const value = Array.isArray(v) ? v.join('|') : v
    if (buildAttributeFilterClauses({ [k]: value }, 1).conditions.length) attrOnly[k] = value
    else ignoredAttributes.push(k)
  }
  const rawIds = list(input.product_ids ?? attrs.product_ids, /[\s,|]+/).map(s => s.toLowerCase())
  const names = list(input.product_names ?? attrs.product_names, /\n/)
  if (rawIds.length > 1000 || names.length > BULK_MAX) {
    throw new Error(`Pass at most ${BULK_MAX} product names and 1000 product ids at a time.`)
  }
  const explicit = rawIds.length > 0 || names.length > 0

  const uuidIds = rawIds.filter(id => UUID_RE.test(id))
  const known = new Set<string>(
    uuidIds.length
      ? (await queryMany<{ id: string }>(`SELECT id::text FROM products WHERE id = ANY($1::uuid[]) AND is_draft = false`, [uuidIds])).map(r => r.id)
      : []
  )
  const byName = new Map<string, { id: string; name: string; sku: string | null }[]>()
  if (names.length) {
    const found = await queryMany<{ wanted: string; id: string; name: string; sku: string | null }>(
      `SELECT w.n AS wanted, p.id::text, p.name, p.sku
         FROM unnest($1::text[]) AS w(n)
         JOIN products p ON p.is_draft = false
          AND (lower(btrim(p.name)) = lower(btrim(w.n)) OR lower(btrim(p.sku)) = lower(btrim(w.n)))
        ORDER BY p.name`,
      [names]
    )
    for (const f of found) byName.set(f.wanted, [...(byName.get(f.wanted) ?? []), { id: f.id, name: f.name, sku: f.sku }])
  }
  const ids = [
    ...new Set([
      ...uuidIds.filter(id => known.has(id)),
      ...names.flatMap(n => (byName.get(n)?.length === 1 ? [byName.get(n)![0].id] : [])),
    ]),
  ]

  const search = text(input.search) || text(attrs.search)
  const categoryRaw = text(input.category) || text(attrs.category_id) || text(attrs.category)
  const brandRaw = text(input.brand) || text(attrs.brand_id) || text(attrs.brand)
  const category = categoryRaw ? await resolveRef('categories', categoryRaw) : null
  const brand = brandRaw ? await resolveRef('brands', brandRaw) : null
  const stock = stockOf(input.stock) ?? stockOf(attrs.stock)
  const defaultStatus = explicit ? 'any' : 'active'
  const status = statusOf(input.status) ?? statusOf(attrs.status) ?? statusOf(attrs.is_active) ?? defaultStatus

  const conditions = ['p.is_draft = false']
  if (status === 'inactive') conditions.push('p.is_active = false')
  else if (status === 'active') conditions.push('p.is_active = true')
  if (stock === 'low') conditions.push(`p.stock_status = 'Low Stock'`)
  else if (stock === 'out') conditions.push(`p.stock_status = 'Out of Stock'`)
  const params: unknown[] = []
  if (category) {
    params.push(category.id)
    const n = params.length
    conditions.push(
      `p.category_id = ANY(SELECT id FROM categories WHERE id = $${n}::uuid UNION SELECT id FROM categories WHERE parent_category_id = $${n}::uuid)`
    )
  }
  if (brand) {
    params.push(brand.id)
    conditions.push(`p.brand_id = $${params.length}::uuid`)
  }
  const attr = buildAttributeFilterClauses(attrOnly, params.length + 1)
  conditions.push(...attr.conditions)
  params.push(...attr.params)
  let searched = false
  if (search) {
    const sc = buildProductSearchClause(search, 'p.name', 'p.sku', 'p.search_vector', params.length + 1)
    // A search with no usable words builds TRUE, which must not count as narrowing.
    if (sc.clause !== 'TRUE') {
      conditions.push(sc.clause)
      params.push(...sc.params)
      searched = true
    }
  }
  if (explicit) {
    params.push(ids)
    conditions.push(`p.id = ANY($${params.length}::uuid[])`)
  }

  const { select, join } = columns(operation, status)
  const rows =
    explicit && !ids.length
      ? []
      : await queryMany<Row>(
          `SELECT p.id::text, p.name, p.sku, ${select}, COUNT(*) OVER()::int AS total
             FROM products p ${join}
            WHERE ${conditions.join(' AND ')}
            ORDER BY p.name, p.id
            LIMIT ${clamp(Math.trunc(limit), 1, BULK_MAX)}`,
          params
        )
  const total = rows.length ? Number(rows[0].total) : 0
  for (const r of rows) delete r.total

  const attrFilters = Object.entries(attrOnly).map(([k, v]) => `${k} = ${v.replace(/\|/g, ' | ')}`)
  return {
    rows,
    total,
    leftOut: explicit ? Math.max(0, ids.length - total) : 0,
    missingIds: rawIds.filter(id => !known.has(id)),
    unmatchedNames: names.filter(n => !byName.has(n)),
    ambiguousNames: names
      .filter(n => (byName.get(n)?.length ?? 0) > 1)
      .map(n => ({ name: n, matches: byName.get(n)!.slice(0, 5) })),
    ignoredAttributes,
    narrowed: explicit || searched || !!category || !!brand || !!stock || status === 'inactive' || attr.conditions.length > 0,
    filters: [
      explicit ? plural(ids.length, 'listed product') : '',
      searched ? `search "${search}"` : '',
      category ? `category ${category.name} (with subcategories)` : '',
      brand ? `brand ${brand.name}` : '',
      ...attrFilters,
      stock === 'low' ? 'Low Stock' : stock === 'out' ? 'Out of Stock' : '',
      status !== defaultStatus ? `status ${status}` : '',
    ].filter(Boolean),
  }
}

function unresolvedNote(t: Targets): string {
  const parts: string[] = []
  if (t.missingIds.length) {
    parts.push(`Unknown or draft product ids: ${t.missingIds.slice(0, 5).join(', ')}${t.missingIds.length > 5 ? ` and ${t.missingIds.length - 5} more` : ''}.`)
  }
  if (t.unmatchedNames.length) parts.push(`No product is named exactly: ${t.unmatchedNames.slice(0, 5).map(n => `"${short(n)}"`).join(', ')}.`)
  if (t.ambiguousNames.length) parts.push(`Several products match: ${t.ambiguousNames.slice(0, 5).map(a => `"${short(a.name)}"`).join(', ')}; pass their ids.`)
  if (t.ignoredAttributes.length) {
    parts.push(`Attribute filters not applied (unknown key or unusable value): ${t.ignoredAttributes.slice(0, 5).map(k => `"${short(k)}"`).join(', ')}.`)
  }
  return parts.join(' ')
}

// ── preview ───────────────────────────────────────────────────────────────────

// The Controls API's price derivation: selling price incl. GST from MRP (Ex-GST), discount and GST.
const priceFrom = (mrpEx: number, disc: number, gst: number) => round2(round2(mrpEx * (1 - disc / 100)) * (1 + gst / 100))

function priceNow(r: Row): string {
  if (r.mrp_ex_gst > 0) {
    const mrp = `MRP ${inr(r.mrp_ex_gst)} ex-GST, ${r.discount_pct ?? 0}% off`
    // Variant products often keep 0 as the product row's price.
    return r.price > 0 ? `${inr(r.price)} (${mrp})` : mrp
  }
  if (r.has_variants && r.variant_mrp_min != null) {
    return `variants, MRP ${inr(r.variant_mrp_min)}${r.variant_mrp_max !== r.variant_mrp_min ? `–${inr(r.variant_mrp_max)}` : ''} ex-GST`
  }
  return 'no MRP (Ex-GST)'
}

function priceAfter(operation: string, n: number, r: Row): string {
  const disc = r.discount_pct ?? 0
  const gst = r.gst_pct ?? 0
  const variants = r.has_variants ? (operation === 'set_mrp_ex_gst' ? '; variants unchanged' : '; variants too') : ''
  if (operation === 'set_mrp_ex_gst') return `${inr(priceFrom(n, disc, gst))} (MRP ${inr(n)} ex-GST)${variants}`
  if (!(r.mrp_ex_gst > 0)) return operation === 'set_discount' ? `variants at ${n}% off` : `variant prices +${n}%`
  if (operation === 'set_discount') return `${inr(priceFrom(r.mrp_ex_gst, n, gst))} (${n}% off)${variants}`
  const mrp = round2(r.mrp_ex_gst * (1 + n / 100))
  return `${inr(priceFrom(mrp, disc, gst))} (MRP ${inr(mrp)} ex-GST)${variants}`
}

function nowOf(op: BulkOp, r: Row): string {
  if (op.field === 'price') return priceNow(r)
  if (op.kind === 'unit') return r.unit ? `${r.unit} (×${r.factor})` : '—'
  const v = r[op.field]
  if (v == null || v === '') return '—'
  if (op.options) return op.options[String(v)] ?? String(v)
  return op.unit ? `${v} ${op.unit}` : String(v)
}

/** Products the operation would leave as they are (the API skips priceless ones; others already match). */
function unchanged(op: BulkOp, value: string | SellingUnit, r: Row): boolean {
  if (op.kind === 'percent' || op.kind === 'discount') return !(r.mrp_ex_gst > 0) && !r.has_variants
  if (op.kind === 'money' || op.kind === 'unit') return false
  const v = r[op.field]
  if (v == null) return false
  return op.kind === 'whole' ? Number(v) === Number(value) : String(v) === value
}

function spreadOf(operation: string | null, rows: Row[]): string {
  const op = operation ? operationOf(operation) : null
  const key = !op ? null : operation === 'set_discount' ? 'discount_pct' : op.field === 'price' ? null : op.kind === 'unit' ? 'unit' : op.field
  if (!op || !key || !rows.length) return ''
  const show = (v: unknown) =>
    v == null || v === '' ? '—' : key === 'discount_pct' ? `${v}%` : op.kind === 'flag' ? (v ? 'yes' : 'no') : String(v)
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(show(r[key]), (counts.get(show(r[key])) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1])
  return `${key} now: ${top.slice(0, 5).map(([v, n]) => `${v} (${n})`).join(', ')}${top.length > 5 ? ', …' : ''}.`
}

function compact(r: Row): Row {
  const out = { ...r }
  if (out.has_variants && out.price === 0) delete out.price
  if (out.has_variants === false) delete out.has_variants
  if (out.variant_mrp_min == null) {
    delete out.variant_mrp_min
    delete out.variant_mrp_max
  }
  return out
}

const when = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export const CONTROLS_TOOLS: ToolDef[] = [
  {
    name: 'find_products_for_bulk_update',
    description:
      'Find the products a bulk change would hit, with the admin Controls page\'s filters (search, category incl. subcategories, brand, attribute filters, status, stock) and/or exact product names or ids. Returns the total, ids, names and the current values the given operation changes (discount_pct and price for set_discount, is_active for set_active, ...), at most 200 rows. Use it to check a selection before propose_bulk_update_products, which takes the same inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: OPERATION_KEYS,
          description: 'The bulk change being prepared; picks which current values come back.',
        },
        ...TARGET_PROPS,
        limit: { type: 'integer', default: 50, minimum: 1, maximum: BULK_MAX },
      },
    },
    mutating: false,
    handler: async input => {
      const operation = text(input.operation) || null
      if (operation && !operationOf(operation)) throw new Error(unknownOperation(operation))
      const limit = clamp(Math.trunc(Number(input.limit)) || 50, 1, BULK_MAX)
      const t = await resolveTargets(input, operation, limit)
      const products = t.rows.map(compact)
      const summary = [
        t.total === 0
          ? `No products match${t.filters.length ? ` (${t.filters.join('; ')})` : ''}.`
          : `${plural(t.total, 'product')} match${t.total === 1 ? 'es' : ''}${t.total > products.length ? `; showing the first ${products.length}` : ''}.`,
        spreadOf(operation, t.rows),
        t.total > BULK_MAX ? `One bulk change takes at most ${BULK_MAX} products: narrow the filters, or use the Controls page.` : '',
        t.leftOut ? `${plural(t.leftOut, 'listed product')} left out by the filters.` : '',
        unresolvedNote(t),
      ]
      return ok({
        summary: summary.filter(Boolean).join(' '),
        count: products.length,
        data: {
          total: t.total,
          ...(t.total > products.length ? { truncated: true } : {}),
          ...(t.filters.length ? { filters: t.filters } : {}),
          ...(t.missingIds.length ? { unknown_ids: t.missingIds } : {}),
          ...(t.unmatchedNames.length ? { unmatched_names: t.unmatchedNames } : {}),
          ...(t.ambiguousNames.length ? { ambiguous_names: t.ambiguousNames } : {}),
          ...(t.ignoredAttributes.length ? { ignored_attributes: t.ignoredAttributes } : {}),
          products,
        },
        displayHints: { primaryField: 'name', itemNoun: 'product' },
      })
    },
  },
  {
    name: 'propose_bulk_update_products',
    description:
      'Propose one bulk change to many products, as the admin Controls page applies it (e.g. a 15% discount on 10 products, prices +5%, a category set inactive). Pick products with product_ids / product_names and/or the filters of find_products_for_bulk_update; they are resolved now, at most 200. value per operation: inflate_price percent > 0 (raises MRP ex-GST); set_discount 0-100 (%); set_mrp_ex_gst rupees > 0; set_tax_class standard|reduced|zero|exempt; set_condition new|used|refurbished; set_shipping_class standard|express|freight; set_handling_days / set_warranty_months whole number ≥ 0; set_target_gender unisex|male|female; set_grade text; set_hsn_code text; set_country_of_origin 2-letter code; set_featured / set_searchable / set_active true|false; set_selling_unit takes selling_unit instead. Image replacement is only on the Controls page. The admin approves; the change is logged in Controls → History and propose_rollback_bulk_update undoes it. Use this instead of one propose_update_product per product.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: OPERATION_KEYS, description: 'Controls operation.' },
        value: { type: 'string', description: 'New value as entered on the Controls page, e.g. "15" for 15%.' },
        selling_unit: {
          type: 'object',
          description:
            'set_selling_unit only: {unit, factor, dimension, display_label, min_qty, max_qty, qty_step}. dimension count|length|area|volume|weight|custom (default count); factor = pieces per unit (count) or m / m² / L / kg per unit, fixed for standard units like dozen or ft; min_qty default 1, max_qty optional, qty_step default 1 (always 1 for count).',
        },
        inherit_to_variants: {
          type: 'boolean',
          default: true,
          description: 'set_selling_unit: also set it on every active variant.',
        },
        ...TARGET_PROPS,
      },
      required: ['operation'],
    },
    mutating: true,
    handler: async input => {
      const operation = text(input.operation)
      const op = operationOf(operation)
      if (!op) throw new Error(unknownOperation(operation))
      const value = bulkValue(op, input)
      const shown = valueLabel(operation, value)
      const inherit = flag(input.inherit_to_variants) ?? true
      const t = await resolveTargets(input, operation, BULK_MAX)
      const unresolved = unresolvedNote(t)
      if (unresolved) throw new Error(`${unresolved} Fix the selection (find_products_for_bulk_update helps) and propose again.`)
      if (!t.narrowed) {
        throw new Error('Say which products to change: product_ids or product_names, or at least one filter (search, category, brand, attributes, stock, status inactive).')
      }
      if (!t.total) return { proposed: false, info: `No products match${t.filters.length ? ` (${t.filters.join('; ')})` : ''}.` }
      if (t.total > BULK_MAX) {
        throw new Error(
          `${t.total} products match; one proposal changes at most ${BULK_MAX}. Narrow the filters (e.g. by category or brand) or split the change, or apply it on the Controls page.`
        )
      }

      const priceless = op.kind === 'percent' || op.kind === 'discount'
      const rows = t.rows.filter(r => !unchanged(op, value, r))
      const left = t.rows.length - rows.length
      if (!rows.length) {
        return {
          proposed: false,
          info: priceless
            ? `None of the ${plural(t.rows.length, 'product')} has an MRP (Ex-GST) or variants, so Controls would skip them all.`
            : `All ${plural(t.rows.length, 'matching product')} already have ${shown}.${
                operation === 'set_active' && value === 'true' ? ' Only active products match unless status is inactive or any.' : ''
              }`,
        }
      }

      const n = rows.length
      const first = rows.slice(0, 3).map(r => short(r.name))
      const after = (r: Row) => (op.field === 'price' ? priceAfter(operation, Number(value), r) : shown)
      const ui_blocks: any[] = [
        { type: 'heading', value: `${op.label}: ${shown}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Products', value: String(n) },
            ...(t.filters.length ? [{ key: 'Selected by', value: t.filters.join('; ') }] : []),
            ...(op.kind === 'unit' ? [{ key: 'Variants', value: inherit ? 'Also set on every active variant' : 'Product level only' }] : []),
            { key: 'Undo', value: 'Controls → History, or ask me to roll it back' },
          ],
        },
        { type: 'table', headers: ['Product', 'SKU', 'Now', 'After'], rows: rows.map(r => [r.name, r.sku || '—', nowOf(op, r), after(r)]) },
      ]
      if (left) {
        ui_blocks.push({
          type: 'callout',
          tone: 'info',
          message: priceless
            ? `Left out ${plural(left, 'product')} with no MRP (Ex-GST) and no variants; Controls skips them.`
            : `Left out ${plural(left, 'product')} that already have this value.`,
        })
      }
      if (t.leftOut) ui_blocks.push({ type: 'callout', tone: 'warn', message: `${plural(t.leftOut, 'listed product')} left out by the filters.` })
      if (priceless) ui_blocks.push({ type: 'callout', tone: 'info', message: 'Active variants and sub-variants are re-priced too, each from its own MRP (Ex-GST).' })
      if (operation === 'set_active' && value === 'false') {
        ui_blocks.push({
          type: 'callout',
          tone: 'warn',
          title: 'Products will be hidden',
          message: 'Inactive products disappear from storefront listings and search.',
        })
      }

      return {
        proposed: true,
        kind: 'bulk_update_products',
        confirmation: `${op.label}: ${shown} on ${plural(n, 'product')} (${first.join(', ')}${n > 3 ? ` +${n - 3} more` : ''})?`,
        payload: {
          operation,
          operationLabel: op.label,
          value,
          valueLabel: shown,
          inheritToVariants: inherit,
          productCount: n,
          productIds: rows.map(r => r.id),
        },
        ui_blocks,
      }
    },
  },
  {
    name: 'propose_rollback_bulk_update',
    description:
      'Propose undoing a bulk change from Controls → History (made on the Controls page or with propose_bulk_update_products): every product gets its before-values back, as Undo there does. Defaults to the latest operation; pass operation (e.g. set_discount) for the latest of that kind, or logId for a specific one. At most 200 products; bigger ones are undone on the Controls page. The admin approves.',
    inputSchema: {
      type: 'object',
      properties: {
        logId: { type: 'string', description: 'Operation log id (the logId a bulk change reported).' },
        operation: { type: 'string', description: 'Undo the latest operation of this kind, e.g. set_discount.' },
      },
    },
    mutating: true,
    handler: async ({ logId, operation }) => {
      const id = text(logId)
      const kind = text(operation)
      if (id && !UUID_RE.test(id)) throw new Error('logId must be an operation log UUID.')
      if (kind && !operationOf(kind) && kind !== 'set_images') throw new Error(unknownOperation(kind))
      const rows = await queryMany<{
        id: string
        operation: string
        value: unknown
        product_count: number
        applied_by: string | null
        applied_at: string
        rolled_back_at: string | null
        sample_names: string[] | null
        later_ops: number
      }>(
        `SELECT l.id::text, l.operation, l.value, l.product_count, l.applied_by, l.applied_at, l.rolled_back_at,
                (SELECT array_agg(s.name) FROM (SELECT p.name FROM products p WHERE p.id = ANY(l.product_ids) ORDER BY p.name LIMIT 3) s) AS sample_names,
                (SELECT COUNT(*)::int FROM controls_operation_log x
                  WHERE x.is_rollback = false AND x.rolled_back_at IS NULL AND x.applied_at > l.applied_at
                    AND x.product_ids && l.product_ids) AS later_ops
           FROM controls_operation_log l
          WHERE l.is_rollback = false ${id ? 'AND l.id = $1::uuid' : kind ? 'AND l.operation = $1' : ''}
          ORDER BY l.applied_at DESC
          LIMIT ${id ? 1 : 5}`,
        id ? [id] : kind ? [kind] : []
      )
      const log = rows[0]
      if (!log) {
        return {
          proposed: false,
          info: id
            ? `No Controls operation has log id ${id}.`
            : `Controls → History has no ${kind ? `${operationLabel(kind)} ` : ''}operation to undo.`,
        }
      }
      const label = operationLabel(log.operation)
      const value = valueLabel(log.operation, log.value)
      const what = `${label}${value ? `: ${value}` : ''}`
      if (log.rolled_back_at) {
        const open = rows.filter(r => !r.rolled_back_at)
        return {
          proposed: false,
          info: `"${what}" (${when(log.applied_at)}) was already undone on ${when(log.rolled_back_at)}.${open.length ? ' Pass logId to undo an older operation.' : ''}`,
          ...(open.length
            ? {
                recent: open.map(r => ({
                  logId: r.id,
                  operation: operationLabel(r.operation),
                  value: valueLabel(r.operation, r.value),
                  products: r.product_count,
                  applied: when(r.applied_at),
                  applied_by: r.applied_by,
                })),
              }
            : {}),
        }
      }

      const n = log.product_count
      if (n > BULK_MAX) {
        return {
          proposed: false,
          info: `"${what}" (${when(log.applied_at)}) changed ${n} products; the assistant undoes at most ${BULK_MAX} at a time. Use Undo in Controls → History.`,
        }
      }
      const names = (log.sample_names ?? []).map(s => short(s, 30))
      const ui_blocks: any[] = [
        { type: 'heading', value: `Undo: ${what}`, level: 2 },
        {
          type: 'kv_pairs',
          pairs: [
            { key: 'Operation', value: label },
            ...(value ? [{ key: 'Value', value }] : []),
            { key: 'Products', value: String(n) },
            { key: 'Applied', value: `${when(log.applied_at)}${log.applied_by ? ` by ${log.applied_by}` : ''}` },
            ...(names.length ? [{ key: 'Includes', value: `${names.join(', ')}${n > names.length ? ` +${n - names.length} more` : ''}` }] : []),
          ],
        },
      ]
      if (log.later_ops > 0) {
        ui_blocks.push({
          type: 'callout',
          tone: 'warn',
          title: 'Later changes overlap',
          message: `${plural(log.later_ops, 'later Controls change')} touched some of these products. Undoing restores the values from before this change and overwrites theirs.`,
        })
      }
      return {
        proposed: true,
        kind: 'rollback_bulk_update',
        confirmation: `Undo "${what}" on ${plural(n, 'product')}${names.length ? ` (${names.join(', ')}${n > names.length ? ` +${n - names.length} more` : ''})` : ''}, applied ${when(log.applied_at)}${log.applied_by ? ` by ${log.applied_by}` : ''}?`,
        payload: { logId: log.id, operation: log.operation, operationLabel: label, valueLabel: value, productCount: n },
        ui_blocks,
      }
    },
  },
]
