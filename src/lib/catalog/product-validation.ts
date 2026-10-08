// Shared product create/edit/publish validation. Client-safe: no server imports; DB helpers take
// an executor (pool helper or a transaction client).

import { STORED_DIMS_REQUIRED } from '@/lib/shipping/shipping'
import { round2 } from '@/lib/catalog/gst'

export interface Exec {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

/** Bind a transaction client to the query/queryOne/queryMany shape used by the product actions. */
export function txDb(client: Exec) {
  return {
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
    queryOne: async <T = any>(sql: string, params?: unknown[]): Promise<T | null> =>
      ((await client.query(sql, params)).rows[0] as T) ?? null,
    queryMany: async <T = any>(sql: string, params?: unknown[]): Promise<T[]> =>
      (await client.query(sql, params)).rows as T[],
  }
}

// ── Slug ──────────────────────────────────────────────────────────────────────

export function slugify(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 240)
    .replace(/-$/, '')
}

/** base, or base-2, base-3 … — the first not in `taken`. */
export function pickUniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!set.has(candidate)) return candidate
  }
}

export async function uniqueProductSlug(db: Exec, name: string, excludeId?: string | null): Promise<string> {
  const base = slugify(name) || 'product'
  const { rows } = await db.query(
    `SELECT slug FROM products WHERE (slug = $1 OR slug LIKE $1 || '-%') AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [base, excludeId ?? null]
  )
  const re = new RegExp(`^${base}(-\\d+)?$`)
  return pickUniqueSlug(
    base,
    (rows || []).map((r: any) => String(r.slug)).filter(s => re.test(s))
  )
}

// ── Prices ────────────────────────────────────────────────────────────────────

export const ALLOWED_GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40]
const MAX_AMOUNT = 9_999_999_999.99 // numeric(12,2)

export type AmountInput = string | number | null | undefined

/** null when blank, NaN when not a finite number. */
export function toAmount(v: AmountInput): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || s === 'null' || s === 'undefined') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

// ── Paise rounding ───────────────────────────────────────────────────────────

export const MONEY_KEYS = [
  'price',
  'mrp',
  'price_ex_gst',
  'mrp_ex_gst',
  'base_price',
  'cost_price',
  'subscription_price',
  'unit_cost',
  'price_override',
]

/** Display string for a loaded money value, rounded to paise. A number (or float-noise string like
 *  "999.9999679999") is rounded; anything else (typed "10.", "") passes through untouched. */
export function paiseString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(round2(v)) : ''
  const s = String(v)
  return /^-?\d*\.\d{3,}$/.test(s.trim()) ? String(round2(Number(s))) : s
}

/** Copy of `row` with its money fields rounded to paise (blank / non-numeric left alone). */
export function roundMoneyFields<T extends Record<string, any>>(row: T, keys: string[] = MONEY_KEYS): T {
  if (!row || typeof row !== 'object') return row
  const out: Record<string, any> = { ...row }
  for (const k of keys) {
    const n = toAmount(out[k])
    if (n != null && !Number.isNaN(n)) out[k] = round2(n)
  }
  return out as T
}

export function gstError(rate: AmountInput): string | null {
  const n = toAmount(rate)
  if (n == null) return null
  if (Number.isNaN(n) || !ALLOWED_GST_RATES.includes(n))
    return `GST rate must be one of ${ALLOWED_GST_RATES.join(', ')}%.`
  return null
}

export interface PriceSet {
  /** Selling price incl. GST. */
  price?: AmountInput
  mrp?: AmountInput
  priceExGst?: AmountInput
  mrpExGst?: AmountInput
  cost?: AmountInput
  discountPct?: AmountInput
}

/** Errors for one product / variant / sub-variant price set. `label` prefixes each message. */
export function priceErrors(label: string, p: PriceSet, opts: { requirePrice?: boolean } = {}): string[] {
  const errors: string[] = []
  const prefix = label ? `${label}: ` : ''
  const fields: [keyof PriceSet, string][] = [
    ['price', 'selling price'],
    ['mrp', 'MRP'],
    ['priceExGst', 'selling price (ex. GST)'],
    ['mrpExGst', 'MRP (ex. GST)'],
    ['cost', 'cost price'],
  ]
  const vals: Partial<Record<keyof PriceSet, number | null>> = {}
  for (const [key, name] of fields) {
    const n = toAmount(p[key])
    vals[key] = n
    if (n == null) continue
    if (Number.isNaN(n)) errors.push(`${prefix}${name} must be a number.`)
    else if (n < 0) errors.push(`${prefix}${name} cannot be negative.`)
    else if (n > MAX_AMOUNT) errors.push(`${prefix}${name} is too large.`)
  }
  const disc = toAmount(p.discountPct)
  if (disc != null && (Number.isNaN(disc) || disc < 0 || disc > 100))
    errors.push(`${prefix}discount must be between 0 and 100%.`)
  if (errors.length > 0) return errors

  const price = vals.price ?? null
  const mrp = vals.mrp ?? null
  if (opts.requirePrice && !(price != null && price > 0)) errors.push(`${prefix}selling price is required to publish.`)
  if (price != null && mrp != null && mrp > 0 && price - mrp > 0.005)
    errors.push(`${prefix}selling price (₹${price}) cannot be higher than MRP (₹${mrp}).`)
  const pex = vals.priceExGst ?? null
  const mex = vals.mrpExGst ?? null
  if (pex != null && mex != null && mex > 0 && pex - mex > 0.005)
    errors.push(`${prefix}selling price ex. GST (₹${pex}) cannot be higher than MRP ex. GST (₹${mex}).`)
  return errors
}

// ── Publish shipping (weight / package dims) ─────────────────────────────────

export interface ShippingDims {
  weight_grams?: AmountInput
  package_type?: string | null
  length_cm?: AmountInput
  breadth_cm?: AmountInput
  height_cm?: AmountInput
}
export interface ShippingSubVariant extends ShippingDims {
  label: string
}
export interface ShippingVariant extends ShippingDims {
  label: string
  /** Set when "has sub-variants" is on: the effective (non-cleared) sub-variant set. */
  subVariants?: ShippingSubVariant[] | null
}

const blank = (x: unknown) => x == null || String(x).trim() === ''
const firstFilled = (...vals: unknown[]) => {
  const hit = vals.find(x => !blank(x))
  return hit == null ? '' : String(hit)
}
const needsDims = (pt: string) => (STORED_DIMS_REQUIRED as string[]).includes(pt)

/** First weight/dimension problem blocking publish, or null. Digital products skip it. */
export function publishShippingError(input: {
  isDigital: boolean
  hasVariants: boolean
  product: ShippingDims
  variants: ShippingVariant[]
}): string | null {
  if (input.isDigital) return null
  const p = input.product
  if (!input.hasVariants) {
    if (!(parseFloat(firstFilled(p.weight_grams)) > 0)) return 'Shipping weight is required and must be greater than 0.'
    if (
      p.package_type &&
      needsDims(p.package_type) &&
      (blank(p.length_cm) || blank(p.breadth_cm) || blank(p.height_cm))
    )
      return 'Dimensions required for this package type'
    return null
  }
  for (const v of input.variants) {
    if (v.subVariants) {
      if (v.subVariants.length === 0)
        return `Variant "${v.label}" has sub-variants enabled but none added. Add a sub-variant or turn off "Has sub-variants".`
      for (const sv of v.subVariants) {
        if (!(parseFloat(firstFilled(sv.weight_grams, v.weight_grams, p.weight_grams)) > 0))
          return `Shipping weight is required for sub-variant "${sv.label}" of "${v.label}" and must be greater than 0.`
        const pt = firstFilled(sv.package_type, v.package_type, p.package_type) || 'flat_poly_auto'
        if (
          needsDims(pt) &&
          (blank(firstFilled(sv.length_cm, v.length_cm)) ||
            blank(firstFilled(sv.breadth_cm, v.breadth_cm)) ||
            blank(firstFilled(sv.height_cm, v.height_cm)))
        )
          return `Dimensions required for this package type (sub-variant "${sv.label}" of "${v.label}")`
      }
      continue
    }
    if (!(parseFloat(firstFilled(v.weight_grams)) > 0))
      return `Shipping weight is required for variant "${v.label}" and must be greater than 0.`
    const pt = v.package_type || 'flat_poly_auto'
    if (needsDims(pt) && (blank(v.length_cm) || blank(v.breadth_cm) || blank(v.height_cm)))
      return `Dimensions required for this package type (variant "${v.label}")`
  }
  return null
}

// ── SKUs ─────────────────────────────────────────────────────────────────────

/** Two entries sharing one SKU (case-insensitive), as a friendly message. */
export function duplicateSkuError(entries: { label: string; sku: string }[]): string | null {
  const seen = new Map<string, string>()
  for (const { label, sku } of entries) {
    const key = String(sku ?? '')
      .trim()
      .toUpperCase()
    if (!key) continue
    const prev = seen.get(key)
    if (prev != null)
      return prev.toLowerCase() === label.toLowerCase()
        ? `Variant "${label}" is listed twice. Variant names must be unique.`
        : `Variants "${prev}" and "${label}" both have SKU "${key}". Rename one of them.`
    seen.set(key, label)
  }
  return null
}

/** Variant names that would generate the same (or an empty) SKU suffix. */
export function variantSkuCollisionError(names: string[], toSku: (name: string) => string): string | null {
  const entries: { label: string; sku: string }[] = []
  for (const raw of names) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    if (!/[a-z0-9]/i.test(name)) return `Variant name "${name}" must contain letters or numbers (it forms the SKU).`
    entries.push({ label: name, sku: toSku(name) })
  }
  return duplicateSkuError(entries)
}

/** SKU already owned by ANOTHER product (or its variants / sub-variants), as a friendly message. */
export async function skuConflictError(
  db: Exec,
  args: { productSku?: string | null; variantSkus?: string[]; productId?: string | null }
): Promise<string | null> {
  const variantSkus = (args.variantSkus || []).filter(Boolean)
  if (!args.productSku && variantSkus.length === 0) return null
  const { rows } = await db.query(
    `SELECT kind, sku, name FROM (
       SELECT 'product' AS kind, p.sku, p.name FROM products p
        WHERE $1::text IS NOT NULL AND p.sku = $1 AND ($3::uuid IS NULL OR p.id <> $3::uuid)
       UNION ALL
       SELECT 'variant', v.sku, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.sku = ANY($2::text[]) AND ($3::uuid IS NULL OR v.product_id <> $3::uuid)
       UNION ALL
       SELECT 'sub-variant', sv.sku, p.name FROM product_sub_variants sv JOIN products p ON p.id = sv.product_id
        WHERE sv.sku = ANY($2::text[]) AND ($3::uuid IS NULL OR sv.product_id <> $3::uuid)
     ) c LIMIT 1`,
    [args.productSku || null, variantSkus, args.productId ?? null]
  )
  const hit = rows?.[0]
  if (!hit) return null
  return hit.kind === 'product'
    ? `SKU "${hit.sku}" is already used by product "${hit.name}". Use a different SKU.`
    : `SKU "${hit.sku}" is already used by a ${hit.kind} of "${hit.name}". Change this product's SKU or rename the variant.`
}

// ── DB error → admin message ─────────────────────────────────────────────────

const UNIQUE_MESSAGES: Record<string, (v: string) => string> = {
  products_sku_key: v => `A product with SKU "${v}" already exists. Use a different SKU.`,
  products_slug_key: v => `Another product already uses the URL "${v}". Change the product name slightly.`,
  product_variants_sku_key: v =>
    `Variant SKU "${v}" is already used by another variant. Change the product SKU or rename the variant.`,
  product_sub_variants_sku_key: v =>
    `Sub-variant SKU "${v}" is already used by another sub-variant. Rename the sub-variant.`,
  products_pkey: () => 'This product was already saved. Reload the page to continue editing it.',
}

/** Maps a Postgres error to a clear message; null when it is not a recognised DB error. */
export function friendlyProductDbError(err: any): string | null {
  if (!err || typeof err !== 'object') return null
  const code: string | undefined = err.code
  const raw = String(err.message || '')
  const detail = String(err.detail || '')
  if (code === '23505' || /duplicate key/i.test(raw)) {
    const constraint: string =
      err.constraint || Object.keys(UNIQUE_MESSAGES).find(k => raw.includes(k) || detail.includes(k)) || ''
    const value = detail.match(/=\((.*)\) already exists/)?.[1] ?? ''
    const fn = UNIQUE_MESSAGES[constraint]
    if (fn) return fn(value)
    return value
      ? `"${value}" is already in use. Use a different value.`
      : 'A record with these details already exists.'
  }
  if (code === '23502') return `Required field "${err.column || 'unknown'}" is missing.`
  if (code === '23503') return 'A selected category, brand or supplier no longer exists. Re-select it and save again.'
  if (code === '22P02' || /invalid input syntax for type (uuid|numeric|integer)/i.test(raw))
    return /uuid/i.test(raw)
      ? 'A selected category, brand or supplier is invalid. Re-select it and save again.'
      : 'A number field contains an invalid value. Check prices, weights and quantities.'
  if (code === '22003') return 'A number is too large. Check prices, weights and quantities.'
  if (code === '23514') {
    if (/digital_no_variants/.test(raw + (err.constraint || ''))) return 'Digital products cannot have variants.'
    if (/cycles/.test(raw + (err.constraint || ''))) return 'Subscription cycle counts must be greater than 0.'
    return 'A value is outside the allowed range.'
  }
  return null
}

export function productErrorMessage(err: any, fallback: string): string {
  return friendlyProductDbError(err) || (err instanceof Error && err.message) || fallback
}

/** Parse a JSON form field; throws a labelled error for malformed input. */
export function parseJsonField<T>(raw: FormDataEntryValue | null, field: string, fallback: T): T {
  if (raw == null || raw === '') return fallback
  try {
    const v = JSON.parse(String(raw))
    return v ?? fallback
  } catch {
    throw new MalformedFieldError(field)
  }
}

export class MalformedFieldError extends Error {
  constructor(field: string) {
    super(`The form sent malformed data for "${field}". Reload the page and try again.`)
    this.name = 'MalformedFieldError'
  }
}

export const DRAFT_NAME_PLACEHOLDER = 'Untitled draft'

/** Everything blocking publish of a create-draft (is_draft = true) straight from its stored rows. */
export async function storedProductPublishErrors(db: Exec, productId: string): Promise<string[]> {
  const p = (
    await db.query(
      `SELECT name, category_id, base_price, mrp, price_ex_gst, mrp_ex_gst, cost_price, gst_percentage,
              has_variants, is_digital, weight_grams, package_type, length_cm, breadth_cm, height_cm
         FROM products WHERE id = $1`,
      [productId]
    )
  ).rows[0]
  if (!p) return ['Product not found.']
  const errors: string[] = []
  if (!String(p.name ?? '').trim() || p.name === DRAFT_NAME_PLACEHOLDER) errors.push('Product name is required.')
  if (!p.category_id) errors.push('Category is required.')
  const gst = gstError(p.gst_percentage)
  if (gst) errors.push(gst)
  const hasVariants = !!p.has_variants && !p.is_digital
  let variants: ShippingVariant[] = []
  if (hasVariants) {
    const vrows = (
      await db.query(
        `SELECT id, variant_name, sku, price, mrp, price_ex_gst, mrp_ex_gst, cost_price, sub_variant_type_on,
                weight_grams, package_type, length_cm, breadth_cm, height_cm
           FROM product_variants WHERE product_id = $1 AND is_active = true ORDER BY created_at`,
        [productId]
      )
    ).rows
    const srows = (
      await db.query(
        `SELECT variant_id, sub_variant_name, price, mrp, weight_grams, package_type, length_cm, breadth_cm, height_cm
           FROM product_sub_variants WHERE product_id = $1 AND is_active = true`,
        [productId]
      )
    ).rows
    if (vrows.length === 0) errors.push('Add at least one variant, or turn off variants.')
    variants = vrows.map((v: any) => {
      const label = v.variant_name || v.sku || ''
      const subs = srows.filter((s: any) => s.variant_id === v.id)
      if (v.sub_variant_type_on || subs.length > 0) {
        for (const s of subs)
          errors.push(
            ...priceErrors(
              `Sub-variant "${s.sub_variant_name}" of "${label}"`,
              { price: s.price, mrp: s.mrp },
              {
                requirePrice: true,
              }
            )
          )
        return { ...v, label, subVariants: subs.map((s: any) => ({ ...s, label: s.sub_variant_name })) }
      }
      errors.push(
        ...priceErrors(
          `Variant "${label}"`,
          { price: v.price, mrp: v.mrp, priceExGst: v.price_ex_gst, mrpExGst: v.mrp_ex_gst, cost: v.cost_price },
          { requirePrice: true }
        )
      )
      return { ...v, label }
    })
  } else {
    errors.push(
      ...priceErrors(
        'Pricing',
        { price: p.base_price, mrp: p.mrp, priceExGst: p.price_ex_gst, mrpExGst: p.mrp_ex_gst, cost: p.cost_price },
        { requirePrice: true }
      )
    )
  }
  const ship = publishShippingError({ isDigital: !!p.is_digital, hasVariants, product: p, variants })
  if (ship) errors.push(ship)
  return [...new Set(errors)]
}

/** A publish/save problem the admin can fix (bad input, SKU/slug clash) — a 4xx, not a server fault. */
export class ProductValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProductValidationError'
  }
}
