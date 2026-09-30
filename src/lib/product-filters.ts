import { queryMany, queryOne } from '@/lib/db'

const PRICE_SQL = 'COALESCE(p.price_ex_gst, p.base_price)'

export interface ProductFilterParams {
  minPrice?: string
  maxPrice?: string
  inStock?: string
  onSale?: string
  brand?: string
  color?: string
  grade?: string
  material?: string
  finish?: string
  compliance?: string
  origin?: string
  variantType?: string
  variantValue?: string
  specKey?: string
  specValue?: string
  offer?: string
}

export interface FilterClauses {
  conditions: string[]
  params: any[]
  nextIdx: number
}

function inClause(
  column: string,
  raw: string,
  startIdx: number
): { clause: string; params: string[]; nextIdx: number } | null {
  const values = raw
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
  if (values.length === 0) return null
  let i = startIdx
  const placeholders = values.map(() => `$${i++}`)
  return { clause: `${column} IN (${placeholders.join(', ')})`, params: values, nextIdx: i }
}

export function buildProductFilterClauses(params: ProductFilterParams, paramIndex: number): FilterClauses {
  const conditions: string[] = []
  const bound: any[] = []
  let i = paramIndex

  if (params.minPrice != null && params.minPrice !== '') {
    conditions.push(`${PRICE_SQL}::numeric >= $${i}::numeric`)
    bound.push(params.minPrice)
    i++
  }
  if (params.maxPrice != null && params.maxPrice !== '') {
    conditions.push(`${PRICE_SQL}::numeric <= $${i}::numeric`)
    bound.push(params.maxPrice)
    i++
  }
  if (params.inStock === '1') conditions.push(`p.stock_status != 'Out of Stock'`)
  if (params.onSale === '1') conditions.push(`p.discount_pct > 0`)

  if (params.brand) {
    const brandVals = params.brand
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
    if (brandVals.length) {
      const placeholders = brandVals.map(() => `$${i++}`)
      conditions.push(
        `p.brand_id IN (SELECT id FROM brands WHERE id::text IN (${placeholders.join(', ')}) OR slug IN (${placeholders.join(', ')}))`
      )
      bound.push(...brandVals)
    }
  }

  const inFilters: Array<[string, string | undefined]> = [
    ['p.color', params.color],
    ['p.grade', params.grade],
    ['p.material', params.material],
    ['p.finish', params.finish],
    ['p.compliance_standard', params.compliance],
    ['p.country_of_origin', params.origin],
  ]
  for (const [column, raw] of inFilters) {
    if (raw == null || raw === '') continue
    const built = inClause(column, raw, i)
    if (!built) continue
    conditions.push(built.clause)
    bound.push(...built.params)
    i = built.nextIdx
  }

  if (params.variantType && params.variantValue) {
    conditions.push(`EXISTS (
      SELECT 1 FROM product_variants pv
      WHERE pv.product_id = p.id AND pv.is_active = true
        AND pv.variant_type = $${i} AND pv.variant_name = $${i + 1}
    )`)
    bound.push(params.variantType, params.variantValue)
    i += 2
  }

  if (params.specKey && params.specValue) {
    conditions.push(`p.specifications @> jsonb_build_object($${i}::text, $${i + 1}::text)`)
    bound.push(params.specKey, params.specValue)
    i += 2
  }

  if (params.offer != null && params.offer !== '') {
    conditions.push(`EXISTS (
      SELECT 1 FROM product_offer_items poi
      JOIN product_offers po ON po.id = poi.offer_id
      WHERE poi.product_id = p.id AND po.is_active = true
        AND (po.slug = $${i} OR po.id::text = $${i})
    )`)
    bound.push(params.offer)
    i++
  }

  return { conditions, params: bound, nextIdx: i }
}

export interface FilterFacetValue {
  value: string
  count: number
}

export interface ColorFacetValue {
  value: string
  hex: string | null
  count: number
}

export interface BrandFacetValue {
  id: string
  name: string
  count: number
}

export interface FilterFacets {
  brands: BrandFacetValue[]
  colors: ColorFacetValue[]
  grades: FilterFacetValue[]
  materials: FilterFacetValue[]
  finishes: FilterFacetValue[]
  compliances: FilterFacetValue[]
  origins: FilterFacetValue[]
  inStockCount: number
  onSaleCount: number
  priceMin: number
  priceMax: number
  variantTypes: FilterFacetValue[]
  variantValues: FilterFacetValue[]
  specFacets: { key: string; values: FilterFacetValue[] }[]
}

function facetQuery(column: string, baseWhere: string): string {
  return `
    SELECT ${column} AS value, COUNT(*) AS count
    FROM products p
    WHERE p.is_active = true AND ${column} IS NOT NULL AND ${column} != '' AND ${baseWhere}
    GROUP BY ${column}
    ORDER BY ${column}
  `
}

export async function getFilterFacets(baseConditions: string[], baseParams: any[]): Promise<FilterFacets> {
  const baseWhere = baseConditions.length ? baseConditions.join(' AND ') : 'TRUE'

  const [
    brands,
    colors,
    grades,
    materials,
    finishes,
    compliances,
    origins,
    aggregates,
    variantTypes,
    variantValues,
    specRows,
  ] = await Promise.all([
    queryMany<{ id: string; name: string; count: string }>(
      `SELECT b.id, b.name, COUNT(p.id)::text AS count
       FROM brands b JOIN products p ON p.brand_id = b.id
       WHERE p.is_active = true AND b.is_active = true AND ${baseWhere}
       GROUP BY b.id, b.name ORDER BY b.name`,
      baseParams
    ),
    queryMany<{ value: string; hex: string | null; count: string }>(
      `SELECT p.color AS value, MAX(p.color_hex) AS hex, COUNT(*)::text AS count
       FROM products p
       WHERE p.is_active = true AND p.color IS NOT NULL AND p.color != '' AND ${baseWhere}
       GROUP BY p.color ORDER BY COUNT(*) DESC`,
      baseParams
    ),
    queryMany<{ value: string; count: string }>(facetQuery('p.grade', baseWhere), baseParams),
    queryMany<{ value: string; count: string }>(facetQuery('p.material', baseWhere), baseParams),
    queryMany<{ value: string; count: string }>(facetQuery('p.finish', baseWhere), baseParams),
    queryMany<{ value: string; count: string }>(facetQuery('p.compliance_standard', baseWhere), baseParams),
    queryMany<{ value: string; count: string }>(facetQuery('p.country_of_origin', baseWhere), baseParams),
    queryOne<{ in_stock_count: string; on_sale_count: string; price_min: string | null; price_max: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE p.stock_status != 'Out of Stock') AS in_stock_count,
         COUNT(*) FILTER (WHERE p.discount_pct > 0) AS on_sale_count,
         MIN(${PRICE_SQL}) AS price_min,
         MAX(${PRICE_SQL}) AS price_max
       FROM products p WHERE p.is_active = true AND ${baseWhere}`,
      baseParams
    ),
    queryMany<{ value: string; count: string }>(
      `SELECT pv.variant_type AS value, COUNT(DISTINCT p.id)::text AS count
       FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE p.is_active = true AND pv.is_active = true AND pv.variant_type IS NOT NULL AND ${baseWhere}
       GROUP BY pv.variant_type ORDER BY pv.variant_type`,
      baseParams
    ),
    queryMany<{ value: string; count: string }>(
      `SELECT pv.variant_name AS value, COUNT(DISTINCT p.id)::text AS count
       FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE p.is_active = true AND pv.is_active = true AND pv.variant_name IS NOT NULL AND ${baseWhere}
       GROUP BY pv.variant_name ORDER BY pv.variant_name`,
      baseParams
    ),
    queryMany<{ key: string; val: string; cnt: string }>(
      `SELECT key, value AS val, COUNT(DISTINCT p.id)::text AS cnt
       FROM products p, jsonb_each_text(p.specifications)
       WHERE p.is_active = true AND p.specifications IS NOT NULL AND ${baseWhere}
       GROUP BY key, value ORDER BY key, COUNT(DISTINCT p.id) DESC`,
      baseParams
    ),
  ])

  const toValues = (rows: { value: string; count: string }[]): FilterFacetValue[] =>
    rows.map(r => ({ value: r.value, count: Number(r.count) }))

  const specMap = new Map<string, FilterFacetValue[]>()
  for (const r of specRows) {
    if (!specMap.has(r.key)) specMap.set(r.key, [])
    specMap.get(r.key)!.push({ value: r.val, count: Number(r.cnt) })
  }

  return {
    brands: brands.map(r => ({ id: r.id, name: r.name, count: Number(r.count) })),
    colors: colors.map(r => ({ value: r.value, hex: r.hex ?? null, count: Number(r.count) })),
    grades: toValues(grades),
    materials: toValues(materials),
    finishes: toValues(finishes),
    compliances: toValues(compliances),
    origins: toValues(origins),
    inStockCount: Number(aggregates?.in_stock_count ?? 0),
    onSaleCount: Number(aggregates?.on_sale_count ?? 0),
    priceMin: Number(aggregates?.price_min ?? 0),
    priceMax: Number(aggregates?.price_max ?? 0),
    variantTypes: toValues(variantTypes),
    variantValues: toValues(variantValues),
    specFacets: Array.from(specMap.entries()).map(([key, values]) => ({ key, values })),
  }
}
