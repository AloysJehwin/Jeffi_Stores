import { NextResponse, type NextRequest } from 'next/server'
import { queryMany } from '@/lib/db'
import type { AdvancedFilterField } from '@/components/admin/AdvancedFilterPanel'
import {
  ALIASED_SPEC_KEYS, COLUMN_SPEC_ALIASES, SPEC_JUNK_SQL, specKeySql, specLabel,
} from '@/lib/product-specs'
import {
  SPEC_PARAM_PREFIX, SPEC_SECTION, specKeyFromParam, specParam, splitFilterValues,
} from '@/lib/product-attribute-filters'

export type FilterParams = Record<string, unknown>
type Bind = (value: unknown) => string

interface ValueSource {
  expr?: string
  arrayExpr?: string
  specKeys?: readonly string[]
  splitList?: boolean
  upper?: boolean
}

const VALUE_SOURCES: Record<string, ValueSource> = {
  grade: { expr: 'p.grade', specKeys: COLUMN_SPEC_ALIASES.grade },
  material: { expr: 'p.material', specKeys: COLUMN_SPEC_ALIASES.material },
  finish: { expr: 'p.finish', specKeys: COLUMN_SPEC_ALIASES.finish },
  color: { expr: 'p.color', specKeys: COLUMN_SPEC_ALIASES.color },
  size: { expr: 'p.size', specKeys: COLUMN_SPEC_ALIASES.size },
  compliance_standard: { expr: 'p.compliance_standard', specKeys: COLUMN_SPEC_ALIASES.compliance_standard, splitList: true },
  safety_rating: { expr: 'p.safety_rating', specKeys: COLUMN_SPEC_ALIASES.safety_rating },
  certifications: { arrayExpr: 'p.certifications' },
  brand_part_number: { expr: 'p.brand_part_number', specKeys: COLUMN_SPEC_ALIASES.brand_part_number },
  hsn_code: { expr: 'p.hsn_code', specKeys: COLUMN_SPEC_ALIASES.hsn_code },
  tax_class: { expr: 'p.tax_class' },
  country_of_origin: { expr: 'p.country_of_origin', upper: true },
  package_type: { expr: 'p.package_type' },
  warranty_type: { expr: 'p.warranty_type' },
  target_gender: { expr: 'p.target_gender' },
  target_audience: { arrayExpr: 'p.target_audience' },
  license_type: { expr: 'p.license_type' },
  file_format: { expr: 'p.file_format' },
  platform_compatibility: { arrayExpr: 'p.platform_compatibility' },
  ai_product_type: { expr: 'p.ai_product_type' },
  variant_type: { expr: 'p.variant_type' },
  data_source: { expr: 'p.data_source' },
  supplier: { expr: '(SELECT s.name FROM suppliers s WHERE s.id = p.supplier_id)' },
  sell_unit: { expr: '(SELECT u.unit FROM product_units u WHERE u.id = p.sell_unit_id)' },
}

const TOGGLES: Record<string, string> = {
  is_featured: 'p.is_featured', has_variants: 'p.has_variants', is_digital: 'p.is_digital',
  is_bundle: 'p.is_bundle', is_subscription: 'p.is_subscription', is_cod_allowed: 'p.is_cod_allowed',
  inclusive_tax: 'p.inclusive_tax', inventory_sync: 'p.inventory_sync', is_oversized: 'p.is_oversized',
  is_searchable: 'p.is_searchable',
}

const FLAGS = ['fragile', 'hazardous', 'flammable', 'perishable', 'serialized']

const MULTI: Record<string, { expr: string; numeric?: boolean }> = {
  condition: { expr: 'p.condition' },
  gst_percentage: { expr: 'p.gst_percentage', numeric: true },
  shipping_class: { expr: 'p.shipping_class' },
}

const RANGES: Record<string, string> = {
  price: '(COALESCE((SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), p.base_price))',
  mrp: 'p.mrp',
  discount: 'p.discount_pct',
  stock: `(CASE WHEN p.has_variants THEN COALESCE((SELECT SUM(
      CASE WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
        ELSE pv.inventory_quantity END
    ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0)
    ELSE p.inventory_quantity END)`,
  weight: 'p.weight_grams',
  handling: 'p.handling_days',
  warranty: 'p.warranty_months',
}

const MAX_VALUES = 50
const MAX_SPEC_FILTERS = 30
const PAGE_SIZE = 50
const SPEC_OBJECT = `CASE WHEN jsonb_typeof(p.specifications) = 'object' THEN p.specifications ELSE '{}'::jsonb END`

function specRowsSql(keys: readonly string[], bind: Bind, split: boolean): string {
  const rows = `SELECT btrim(x.val) AS val
    FROM jsonb_each(${SPEC_OBJECT}) e
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(e.value) = 'array' THEN e.value ELSE jsonb_build_array(e.value #>> '{}') END) x(val)
    WHERE ${specKeySql('e.key')} IN (${keys.map(bind).join(', ')})`
  return split ? `SELECT btrim(y) AS val FROM (${rows}) z, regexp_split_to_table(z.val, ',') y` : rows
}

/** Every value a product carries for the attribute, one row each (correlated to products p). */
function sourceRowsSql(source: ValueSource, bind: Bind): string {
  const parts: string[] = []
  if (source.expr) {
    parts.push(source.splitList
      ? `SELECT btrim(y) AS val FROM regexp_split_to_table(${source.expr}, ',') y`
      : `SELECT btrim(${source.expr}) AS val`)
  }
  if (source.arrayExpr) parts.push(`SELECT btrim(y) AS val FROM unnest(${source.arrayExpr}) y`)
  if (source.specKeys?.length) parts.push(specRowsSql(source.specKeys, bind, !!source.splitList))
  return parts.join(' UNION ALL ')
}

function sourceFor(param: string): ValueSource | null {
  if (Object.hasOwn(VALUE_SOURCES, param)) return VALUE_SOURCES[param]
  const key = specKeyFromParam(param)
  return key ? { specKeys: [key] } : null
}

function matchSql(source: ValueSource, values: string[], bind: Bind): string {
  const fold = source.upper ? 'upper' : 'lower'
  const wanted = values.map(v => `${fold}(${bind(v)})`).join(', ')
  if (source.expr && !source.splitList && !source.arrayExpr && !source.specKeys) {
    return `${fold}(btrim(${source.expr})) IN (${wanted})`
  }
  return `EXISTS (SELECT 1 FROM (${sourceRowsSql(source, bind)}) s WHERE ${fold}(s.val) IN (${wanted}))`
}

const first = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '').trim()
const list = (v: unknown) => splitFilterValues(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v : '')
const isNumber = (v: string) => v !== '' && Number.isFinite(Number(v))
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * WHERE conditions for every attribute filter in the query string (the product list and the Controls
 * page share them). Values are bound raw and compared case-insensitively in SQL.
 */
export function buildAttributeFilterClauses(sp: FilterParams, startIdx: number): { conditions: string[]; params: unknown[]; nextIdx: number } {
  const conditions: string[] = []
  const params: unknown[] = []
  const bind: Bind = value => {
    params.push(value)
    return `$${startIdx + params.length - 1}`
  }

  for (const [param, column] of Object.entries(TOGGLES)) {
    const v = first(sp[param])
    if (v === 'true' || v === 'false') conditions.push(`${column} = ${bind(v === 'true')}`)
  }
  for (const flag of FLAGS) {
    const v = first(sp[flag])
    if (v === 'true' || v === 'false') conditions.push(`p.${flag} = ${v}`)
  }
  for (const [param, { expr, numeric }] of Object.entries(MULTI)) {
    const values = first(sp[param]).split(',').map(v => v.trim()).filter(v => v && (!numeric || isNumber(v))).slice(0, MAX_VALUES)
    if (values.length === 0) continue
    conditions.push(numeric
      ? `${expr} IN (${values.map(v => `${bind(v)}::numeric`).join(', ')})`
      : `lower(btrim(${expr})) IN (${values.map(v => `lower(${bind(v)})`).join(', ')})`)
  }
  for (const [base, expr] of Object.entries(RANGES)) {
    const min = first(sp[`${base}_min`])
    const max = first(sp[`${base}_max`])
    if (isNumber(min)) conditions.push(`${expr} >= ${bind(min)}::numeric`)
    if (isNumber(max)) conditions.push(`${expr} <= ${bind(max)}::numeric`)
  }
  const from = first(sp.created_from)
  const to = first(sp.created_to)
  if (isDate(from)) conditions.push(`p.created_at >= ${bind(from)}::date`)
  if (isDate(to)) conditions.push(`p.created_at < ${bind(to)}::date + 1`)

  const specParams = Object.keys(sp).filter(k => k.startsWith(SPEC_PARAM_PREFIX)).sort().slice(0, MAX_SPEC_FILTERS)
  for (const param of [...Object.keys(VALUE_SOURCES), ...specParams]) {
    const values = list(sp[param]).slice(0, MAX_VALUES)
    const source = values.length > 0 ? sourceFor(param) : null
    if (source) conditions.push(matchSql(source, values, bind))
  }

  return { conditions, params, nextIdx: startIdx + params.length }
}

export interface AttributeValue {
  value: string
  count: number
}

/** The distinct values of one attribute with their product counts, most common first; null for an unknown attribute. */
export async function getAttributeValues(param: string, search: string, page: number): Promise<AttributeValue[] | null> {
  const source = sourceFor(param)
  if (!source) return null
  const params: unknown[] = []
  const bind: Bind = value => {
    params.push(value)
    return `$${params.length}`
  }
  const rows = sourceRowsSql(source, bind)
  const needle = search.trim().slice(0, 100).replace(/[\\%_]/g, m => `\\${m}`)
  const searchSql = needle ? `AND v.val ILIKE ${bind(`%${needle}%`)}` : ''
  const offset = bind((Math.max(1, page) - 1) * PAGE_SIZE)
  return queryMany<AttributeValue>(
    `SELECT mode() WITHIN GROUP (ORDER BY v.val) AS value, count(DISTINCT p.id)::int AS count
     FROM products p CROSS JOIN LATERAL (${rows}) v
     WHERE p.is_draft = false AND v.val IS NOT NULL AND lower(v.val) NOT IN ${SPEC_JUNK_SQL} ${searchSql}
     GROUP BY ${source.upper ? 'upper' : 'lower'}(v.val)
     ORDER BY count DESC, value
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    params,
  )
}

/** The value-help popup payload for ?field=&search=&page= (callers authenticate first). */
export async function attributeValuesResponse(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const field = searchParams.get('field') || ''
  const values = await getAttributeValues(field, searchParams.get('search') || '', page)
  if (!values) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  return NextResponse.json({ values, field })
}

/** One value-help filter per technical-spec key used by at least `minProducts` products, busiest first. */
export async function getSpecFilterFields(minProducts = 2): Promise<AdvancedFilterField[]> {
  const rows = await queryMany<{ key: string; label: string | null; raw: string }>(
    `SELECT ${specKeySql('e.key')} AS key,
            mode() WITHIN GROUP (ORDER BY e.key) FILTER (WHERE e.key ~ '[A-Z ]' AND strpos(e.key, '_') = 0) AS label,
            mode() WITHIN GROUP (ORDER BY e.key) AS raw
     FROM products p CROSS JOIN LATERAL jsonb_each(${SPEC_OBJECT}) e
     WHERE p.is_draft = false AND jsonb_typeof(e.value) <> 'null' AND e.value <> '[]'::jsonb
       AND lower(btrim(e.value #>> '{}')) NOT IN ${SPEC_JUNK_SQL}
     GROUP BY 1
     HAVING count(DISTINCT p.id) >= $1
     ORDER BY count(DISTINCT p.id) DESC, 1
     LIMIT 200`,
    [minProducts],
  ).catch(err => {
    console.error('[product-attribute-filters] spec fields', err)
    return [] as { key: string; label: string | null; raw: string }[]
  })
  return rows
    .filter(r => r.key && !ALIASED_SPEC_KEYS.has(r.key))
    .map(r => ({
      name: specParam(r.key),
      label: r.label ? r.label.replace(/\s+/g, ' ').trim() : specLabel(r.raw),
      type: 'value-help' as const,
      section: SPEC_SECTION,
      placeholder: 'Any value',
    }))
}
