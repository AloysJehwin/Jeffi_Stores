import { queryOne, queryMany, queryCount } from './shared'
import { buildSearchClause, buildProductSearchClause, buildProductSearchRank } from '@/lib/catalog/search'
import { buildAttributeFilterClauses, type FilterParams } from '@/lib/catalog/product-attribute-filters'

export async function getAllProducts() {
  const products = await queryMany(`
    SELECT
      p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT COUNT(*) FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
          AND (
            (EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
             AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'))
            OR
            (NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
             AND pv.stock_status != 'Out of Stock')
          )
        ),
        0
      ) AS variant_stock_total,
      COALESCE(
        (SELECT SUM(
          CASE
            WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
            ELSE pv.inventory_quantity
          END
        ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        0
      ) AS variant_inventory_total,
      (SELECT MIN(price) FROM (
        SELECT pv.price
        FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        UNION ALL
        SELECT sv.price
        FROM product_sub_variants sv
        JOIN product_variants pv ON pv.id = sv.variant_id
        WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
      ) AS combined_prices) AS variant_min_price
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC
  `)
  return products
}

export async function getProduct(id: string) {
  const product = await queryOne(
    `
    SELECT
      p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT json_agg(
          jsonb_build_object(
            'id', pv.id, 'sku', pv.sku, 'variant_name', pv.variant_name,
            'price', pv.price, 'mrp', pv.mrp, 'mrp_ex_gst', pv.mrp_ex_gst, 'price_ex_gst', pv.price_ex_gst,
            'stock_status', pv.stock_status, 'inventory_quantity', pv.inventory_quantity,
            'mpn', pv.mpn, 'gtin', pv.gtin, 'asin', pv.asin, 'asin_match', pv.asin_match, 'isbn', pv.isbn, 'pricing_type', pv.pricing_type,
            'unit', pv.unit, 'numeric_value', pv.numeric_value,
            'weight_grams', pv.weight_grams, 'package_type', pv.package_type,
            'length_cm', pv.length_cm, 'breadth_cm', pv.breadth_cm, 'height_cm', pv.height_cm,
            'sub_variant_type', pv.sub_variant_type, 'variant_type', pv.variant_type,
            'is_active', pv.is_active,
            'variant_images', COALESCE(
              (SELECT json_agg(vi ORDER BY vi.display_order)
               FROM variant_images vi WHERE vi.variant_id = pv.id),
              '[]'::json
            ),
            'sub_variants', COALESCE(
              (SELECT json_agg(
                jsonb_build_object(
                  'id', sv.id, 'sub_variant_name', sv.sub_variant_name, 'sku', sv.sku,
                  'price', sv.price, 'mrp', sv.mrp, 'mrp_ex_gst', sv.mrp_ex_gst,
                  'price_ex_gst', sv.price_ex_gst,
                  'stock_status', sv.stock_status, 'inventory_quantity', sv.inventory_quantity,
                  'is_active', sv.is_active
                )
                ORDER BY sv.is_active DESC, sv.sub_variant_name
              )
               FROM product_sub_variants sv WHERE sv.variant_id = pv.id),
              '[]'::json
            ),
            'sub_variant_min_price', (SELECT MIN(sv.price) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.price IS NOT NULL),
            'sub_variant_stock_total', COALESCE((SELECT COUNT(*) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'), 0),
            'sub_variant_inventory_total', COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
          )
          ORDER BY pv.is_active DESC, pv.variant_name
        )
         FROM product_variants pv WHERE pv.product_id = p.id),
        '[]'::json
      ) AS product_variants,
      COALESCE(
        (SELECT json_agg(row_to_json(ps_cur) ORDER BY ps_cur.unit_cost ASC)
         FROM (
           SELECT DISTINCT ON (ps.variant_id, ps.sub_variant_id, ps.supplier_id)
             ps.id, ps.supplier_id, s.name AS supplier_name,
             ps.variant_id, ps.sub_variant_id,
             ps.unit_cost, ps.currency, ps.gst_inclusive, ps.moq,
             ps.lead_time_days, ps.is_preferred, ps.effective_date, ps.notes
           FROM product_suppliers ps
           JOIN suppliers s ON s.id = ps.supplier_id
           WHERE ps.product_id = p.id AND ps.is_active = true
           ORDER BY ps.variant_id, ps.sub_variant_id, ps.supplier_id, ps.effective_date DESC, ps.created_at DESC
         ) ps_cur),
        '[]'::json
      ) AS product_suppliers,
      COALESCE(
        (SELECT COUNT(*) FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
          AND (
            (EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
             AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'))
            OR
            (NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
             AND pv.stock_status != 'Out of Stock')
          )
        ),
        0
      ) AS variant_stock_total,
      COALESCE(
        (SELECT SUM(
          CASE
            WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
            ELSE pv.inventory_quantity
          END
        ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        0
      ) AS variant_inventory_total,
      (SELECT MIN(price) FROM (
        SELECT pv.price
        FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        UNION ALL
        SELECT sv.price
        FROM product_sub_variants sv
        JOIN product_variants pv ON pv.id = sv.variant_id
        WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
      ) AS combined_prices) AS variant_min_price
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = $1
  `,
    [id]
  )

  if (!product) throw new Error('Product not found')
  return product
}

export async function getAllCategories() {
  return queryMany('SELECT * FROM categories WHERE is_draft = false ORDER BY display_order ASC')
}

export async function getAllBrands() {
  return queryMany('SELECT * FROM brands WHERE is_active = $1 ORDER BY name ASC', [true])
}

export async function getCategoriesWithProducts() {
  return queryMany(`
    SELECT DISTINCT c.*
    FROM categories c
    WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
    ORDER BY c.display_order ASC
  `)
}

export async function getBrandsWithProducts() {
  return queryMany(`
    SELECT DISTINCT b.*
    FROM brands b
    WHERE b.is_active = true
      AND EXISTS (SELECT 1 FROM products p WHERE p.brand_id = b.id)
    ORDER BY b.name ASC
  `)
}

const PRODUCT_SORT_COLS: Record<string, string> = {
  name: 'p.name',
  sku: 'p.sku',
  // products has no `price` column — use the effective display price (min active variant
  // price, else base_price). Sorting by 'p.price' errored the whole page.
  price:
    '(COALESCE((SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), p.base_price))',
  stock: 'p.stock_status',
  created_at: 'p.created_at',
  category: 'c.name',
  brand: 'b.name',
  status: 'p.is_active',
}

export async function getFilteredProducts(filters: {
  category_id?: string
  brand_id?: string
  is_active?: string
  stock?: string
  search?: string
  is_featured?: string
  has_variants?: string
  price_min?: string
  price_max?: string
  gst_percentage?: string
  condition?: string
  grade?: string
  is_digital?: string
  is_bundle?: string
  is_cod_allowed?: string
  shipping_class?: string
  is_oversized?: string
  country_of_origin?: string
  fragile?: string
  hazardous?: string
  perishable?: string
  serialized?: string
  attributes?: FilterParams
  page?: number
  limit?: number
  sort?: string
  dir?: string
}) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  // Never-published create-drafts live only in the Drafts section, never the live list —
  // even under the Inactive status filter (a create-draft is is_active=false AND is_draft=true).
  conditions.push(`p.is_draft = false`)

  if (filters.category_id) {
    conditions.push(`p.category_id IN (
      WITH RECURSIVE cat_tree AS (
        SELECT id FROM categories WHERE id = $${i}
        UNION ALL
        SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
      )
      SELECT id FROM cat_tree
    )`)
    params.push(filters.category_id)
    i++
  }
  if (filters.brand_id) {
    conditions.push(`p.brand_id = $${i++}`)
    params.push(filters.brand_id)
  }
  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`p.is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  } else {
    // By default exclude products that have a pending draft (they show in draft context only)
    // A product has a draft when there's a row in product_drafts for it.
    // All products are shown; we no longer shadow-copy inactive draft rows.
    // (product_drafts is the new draft table — no draft_of_id column on products)
  }
  if (filters.stock === 'low') {
    conditions.push(`p.stock_status = 'Low Stock'`)
  } else if (filters.stock === 'out') {
    conditions.push(`p.stock_status = 'Out of Stock'`)
  }
  const attr = buildAttributeFilterClauses({ ...filters, ...filters.attributes }, i)
  conditions.push(...attr.conditions)
  params.push(...attr.params)
  i = attr.nextIdx
  let rankExpr = '0::int'
  if (filters.search) {
    const sc = buildProductSearchClause(filters.search, 'p.name', 'p.sku', 'p.search_vector', i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const countParams = [...params]

  if (filters.search) {
    const rk = buildProductSearchRank(filters.search, 'p.name', 'p.search_vector', i)
    rankExpr = rk.rank
    params.push(...rk.params)
    i = rk.nextIdx
  }

  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit
  const hasSortFilter = filters.sort && PRODUCT_SORT_COLS[filters.sort]
  const sortCol = hasSortFilter ? PRODUCT_SORT_COLS[filters.sort!] : null
  const sortDir = filters.dir === 'asc' ? 'ASC' : 'DESC'
  const orderBy = sortCol
    ? `${sortCol} ${sortDir}`
    : `${rankExpr}, p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC`

  const [products, total] = await Promise.all([
    queryMany(
      `
      SELECT
        p.*,
        json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
        json_build_object('id', b.id, 'name', b.name, 'slug', b.slug) AS brands,
        COALESCE(
          (SELECT json_agg(pi ORDER BY pi.display_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) AS product_images,
        COALESCE(
          (SELECT COUNT(*) FROM product_variants pv
            WHERE pv.product_id = p.id AND pv.is_active = true
            AND (
              (EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
               AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'))
              OR
              (NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
               AND pv.stock_status != 'Out of Stock')
            )
          ),
          0
        ) AS variant_stock_total,
        COALESCE(
          (SELECT SUM(
            CASE
              WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
              THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
              ELSE pv.inventory_quantity
            END
          ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          0
        ) AS variant_inventory_total,
        (SELECT MIN(price) FROM (
          SELECT pv.price
          FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
          UNION ALL
          SELECT sv.price
          FROM product_sub_variants sv
          JOIN product_variants pv ON pv.id = sv.variant_id
          WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
        ) AS combined_prices) AS variant_min_price,
        (SELECT MIN(mrp) FROM (
          SELECT pv.mrp
          FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true AND pv.mrp IS NOT NULL AND pv.mrp > 0
            AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
          UNION ALL
          SELECT sv.mrp
          FROM product_sub_variants sv
          JOIN product_variants pv ON pv.id = sv.variant_id
          WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.mrp IS NOT NULL AND sv.mrp > 0
        ) AS combined_mrps) AS variant_min_mrp,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', pv.id,
              'variant_name', pv.variant_name,
              'inventory_quantity', pv.inventory_quantity,
              'stock_status', pv.stock_status,
              'sub_variant_inventory_total', COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0),
              'sub_variant_stock_total', COALESCE((SELECT COUNT(*) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'), 0),
              'sub_variants', COALESCE(
                (SELECT json_agg(json_build_object('id', sv.id, 'sub_variant_name', sv.sub_variant_name, 'inventory_quantity', sv.inventory_quantity, 'stock_status', sv.stock_status) ORDER BY sv.id)
                 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
                '[]'::json
              )
            ) ORDER BY pv.id
          ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          '[]'::json
        ) AS product_variants
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_category_id = pc.id
      LEFT JOIN brands b ON p.brand_id = b.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${i} OFFSET $${i + 1}
    `,
      [...params, limit, offset]
    ),
    queryCount(`SELECT COUNT(*) FROM products p ${where}`, countParams),
  ])

  return { products, total }
}

export async function getFilteredCategories(filters: { is_active?: string; type?: string; search?: string }) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  // Never-published drafts live only in the Drafts section, never the live list.
  conditions.push(`is_draft = false`)

  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  }
  if (filters.type === 'main') {
    conditions.push(`parent_category_id IS NULL`)
  } else if (filters.type === 'sub') {
    conditions.push(`parent_category_id IS NOT NULL`)
  }
  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['name'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return queryMany(`SELECT * FROM categories ${where} ORDER BY display_order ASC`, params)
}
