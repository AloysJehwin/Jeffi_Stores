import { getDashboardInsights, rangeDays, type DashboardInsights } from './dashboard-insights'
import { queryOne, queryMany, queryCount } from './db'
import { DashboardStats } from '@/types'
import { buildSearchClause, buildProductSearchClause, buildProductSearchRank, buildVectorSearchClause } from './search'
import { getStockValuation } from './inventory'

export const VARIANT_STOCK_TOTAL_SQL = `
  COALESCE((SELECT COUNT(*) FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true
    AND (
      (EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
       AND EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.stock_status != 'Out of Stock'))
      OR
      (NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
       AND pv.stock_status != 'Out of Stock')
    )
  ), 0)
`

export const VARIANT_INVENTORY_TOTAL_SQL = `
  COALESCE((SELECT SUM(
    CASE
      WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
      THEN COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
      ELSE pv.inventory_quantity
    END
  ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0)
`

export const VARIANT_MIN_PRICE_SQL = `
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
  ) AS combined_prices)
`

export const VARIANT_MIN_PRICE_INCL_GST_SQL = `
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
  ) AS combined_prices)
`

// Ex-GST variant of the min-price SQL: prefer the stored ex-GST column, fall
// back to the inclusive price when it is NULL/0. Used by listing pages when the
// GST feature flag is OFF so displayed prices match what checkout will charge.
export const VARIANT_MIN_PRICE_EX_GST_SQL = `
  (SELECT MIN(price) FROM (
    SELECT COALESCE(NULLIF(pv.price_ex_gst, 0), pv.price) AS price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = true AND pv.price IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
    UNION ALL
    SELECT COALESCE(NULLIF(sv.price_ex_gst, 0), sv.price) AS price
    FROM product_sub_variants sv
    JOIN product_variants pv ON pv.id = sv.variant_id
    WHERE pv.product_id = p.id AND pv.is_active = true AND sv.is_active = true AND sv.price IS NOT NULL
  ) AS combined_prices)
`

export const VARIANT_MIN_MRP_SQL = `
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
  ) AS combined_mrps)
`

export const EFFECTIVE_STOCK_SQL = `
  CASE
    WHEN p.has_variants = true THEN ${VARIANT_INVENTORY_TOTAL_SQL}
    ELSE COALESCE(p.inventory_quantity, 0)
  END
`

export const EFFECTIVE_PRICE_SQL = `COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price, 0)`

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      totalProducts,
      totalOrders,
      revenueResult,
      totalCustomers,
      lowStockProducts,
      pendingOrders,
      newCustomersThisMonth,
    ] = await Promise.all([
      queryCount('SELECT COUNT(*) FROM products'),
      queryCount('SELECT COUNT(*) FROM orders'),
      queryOne<{ total: string; online: string; offline: string }>(`
        SELECT
          COALESCE(SUM(total_amount), 0) AS total,
          COALESCE(SUM(CASE WHEN source = 'online' THEN total_amount ELSE 0 END), 0) AS online,
          COALESCE(SUM(CASE WHEN source = 'offline' THEN total_amount ELSE 0 END), 0) AS offline
        FROM orders WHERE payment_status = $1
      `, ['paid']),
      queryCount('SELECT COUNT(*) FROM users WHERE is_active = $1 AND is_guest = $2', [true, false]),
      queryCount("SELECT COUNT(*) FROM products WHERE stock_status = 'Low Stock'"),
      queryCount('SELECT COUNT(*) FROM orders WHERE status = $1', ['pending']),
      queryCount("SELECT COUNT(*) FROM users WHERE is_active = TRUE AND is_guest = FALSE AND created_at >= date_trunc('month', NOW())"),
    ])

    const [onlineOrders, offlineOrders] = await Promise.all([
      queryCount("SELECT COUNT(*) FROM orders WHERE source = 'online'"),
      queryCount("SELECT COUNT(*) FROM orders WHERE source = 'offline'"),
    ])

    return {
      totalProducts,
      totalOrders,
      onlineOrders,
      offlineOrders,
      totalRevenue: parseFloat(revenueResult?.total || '0'),
      onlineRevenue: parseFloat(revenueResult?.online || '0'),
      offlineRevenue: parseFloat(revenueResult?.offline || '0'),
      totalCustomers,
      newCustomersThisMonth,
      lowStockProducts,
      pendingOrders,
    }
  } catch {
    return {
      totalProducts: 0,
      totalOrders: 0,
      onlineOrders: 0,
      offlineOrders: 0,
      totalRevenue: 0,
      onlineRevenue: 0,
      offlineRevenue: 0,
      totalCustomers: 0,
      newCustomersThisMonth: 0,
      lowStockProducts: 0,
      pendingOrders: 0,
    }
  }
}

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
  const product = await queryOne(`
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
  `, [id])

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

export async function getAllOrders() {
  return queryMany(`
    SELECT
      o.*,
      json_build_object(
        'id', u.id, 'email', u.email, 'first_name', u.first_name,
        'last_name', u.last_name, 'phone', u.phone
      ) AS users
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC
  `)
}

const ORDER_SORT_COLS: Record<string, string> = {
  order_number: 'o.order_number',
  customer: 'o.customer_name',
  date: 'o.created_at',
  total: 'o.total_amount',
  status: 'o.status',
  payment: 'o.payment_status',
  source: 'o.source',
}

export async function getFilteredOrders(filters: {
  status?: string
  payment_status?: string
  source?: string
  search?: string
  date_from?: string
  date_to?: string
  amount_min?: string
  amount_max?: string
  awb?: string
  shipment_status?: string
  payment_mode?: string
  coupon_code?: string
  cod_pending?: string
  page?: number
  limit?: number
  sort?: string
  dir?: string
}) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  if (filters.status) {
    conditions.push(`o.status = $${i++}`)
    params.push(filters.status)
  }
  if (filters.payment_status) {
    conditions.push(`o.payment_status = $${i++}`)
    params.push(filters.payment_status)
  }
  if (filters.source) {
    conditions.push(`o.source = $${i++}`)
    params.push(filters.source)
  }
  if (filters.date_from) {
    conditions.push(`o.created_at >= $${i++}::timestamptz`)
    params.push(filters.date_from)
  }
  if (filters.date_to) {
    conditions.push(`o.created_at <= ($${i++}::date + INTERVAL '1 day')::timestamptz`)
    params.push(filters.date_to)
  }
  if (filters.amount_min) {
    conditions.push(`o.total_amount >= $${i++}::numeric`)
    params.push(filters.amount_min)
  }
  if (filters.amount_max) {
    conditions.push(`o.total_amount <= $${i++}::numeric`)
    params.push(filters.amount_max)
  }
  if (filters.awb) {
    conditions.push(`o.awb_number ILIKE '%' || $${i++} || '%'`)
    params.push(filters.awb)
  }
  if (filters.shipment_status) {
    conditions.push(`o.shipment_status = $${i++}`)
    params.push(filters.shipment_status)
  }
  if (filters.payment_mode) {
    conditions.push(`o.payment_mode = $${i++}`)
    params.push(filters.payment_mode)
  }
  if (filters.coupon_code) {
    conditions.push(`o.coupon_code ILIKE '%' || $${i++} || '%'`)
    params.push(filters.coupon_code)
  }
  // COD cash collected on delivery but not yet remitted by Delhivery to the seller.
  if (filters.cod_pending === 'true' || filters.cod_pending === '1') {
    conditions.push(`o.payment_mode = 'cod' AND o.payment_status = 'cod_collected' AND o.cod_remitted_at IS NULL`)
  }
  if (filters.search) {
    const sc = buildVectorSearchClause(filters.search, 'o.search_vector', ['o.customer_name'], ['o.order_number'], i, 'simple')
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit
  const sortCol = ORDER_SORT_COLS[filters.sort || ''] || 'o.created_at'
  const sortDir = filters.dir === 'asc' ? 'ASC' : 'DESC'

  const [orders, countResult] = await Promise.all([
    queryMany(`
      SELECT
        o.*,
        json_build_object(
          'id', u.id, 'email', u.email, 'first_name', u.first_name,
          'last_name', u.last_name, 'phone', u.phone
        ) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ${where}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM orders o ${where}`, params),
  ])

  return { orders, total: countResult }
}

const PRODUCT_SORT_COLS: Record<string, string> = {
  name: 'p.name',
  sku: 'p.sku',
  // products has no `price` column — use the effective display price (min active variant
  // price, else base_price). Sorting by 'p.price' errored the whole page.
  price: '(COALESCE((SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), p.base_price))',
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
  if (filters.is_featured === 'true' || filters.is_featured === 'false') {
    conditions.push(`p.is_featured = $${i++}`)
    params.push(filters.is_featured === 'true')
  }
  if (filters.has_variants === 'true' || filters.has_variants === 'false') {
    conditions.push(`p.has_variants = $${i++}`)
    params.push(filters.has_variants === 'true')
  }
  if (filters.price_min) {
    conditions.push(`COALESCE((SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), p.base_price) >= $${i++}::numeric`)
    params.push(filters.price_min)
  }
  if (filters.price_max) {
    conditions.push(`COALESCE((SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), p.base_price) <= $${i++}::numeric`)
    params.push(filters.price_max)
  }
  if (filters.gst_percentage) {
    conditions.push(`p.gst_percentage = $${i++}::numeric`)
    params.push(filters.gst_percentage)
  }
  if (filters.condition) {
    conditions.push(`p.condition = $${i++}`)
    params.push(filters.condition)
  }
  if (filters.grade) {
    conditions.push(`p.grade = $${i++}`)
    params.push(filters.grade)
  }
  if (filters.is_digital === 'true' || filters.is_digital === 'false') {
    conditions.push(`p.is_digital = $${i++}`)
    params.push(filters.is_digital === 'true')
  }
  if (filters.is_bundle === 'true' || filters.is_bundle === 'false') {
    conditions.push(`p.is_bundle = $${i++}`)
    params.push(filters.is_bundle === 'true')
  }
  if (filters.is_cod_allowed === 'true' || filters.is_cod_allowed === 'false') {
    conditions.push(`p.is_cod_allowed = $${i++}`)
    params.push(filters.is_cod_allowed === 'true')
  }
  if (filters.shipping_class) {
    conditions.push(`p.shipping_class = $${i++}`)
    params.push(filters.shipping_class)
  }
  if (filters.is_oversized === 'true' || filters.is_oversized === 'false') {
    conditions.push(`p.is_oversized = $${i++}`)
    params.push(filters.is_oversized === 'true')
  }
  if (filters.country_of_origin) {
    conditions.push(`p.country_of_origin = $${i++}`)
    params.push(filters.country_of_origin.toUpperCase())
  }
  if (filters.fragile === 'true') { conditions.push(`p.fragile = true`) }
  if (filters.hazardous === 'true') { conditions.push(`p.hazardous = true`) }
  if (filters.perishable === 'true') { conditions.push(`p.perishable = true`) }
  if (filters.serialized === 'true') { conditions.push(`p.serialized = true`) }
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
    queryMany(`
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
    `, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM products p ${where}`, countParams),
  ])

  return { products, total }
}

export interface BrochureProduct {
  id: string
  name: string
  slug: string
  sku: string
  short_description: string | null
  mrp: number | null
  base_price: number | null
  discount_pct: number | null
  brand_name: string | null
  category_name: string | null
  thumbnail_url: string | null
}

// Shared lean projection for every brochure query. Primary image (fallback:
// first by display_order) is joined for the thumbnail. Only active products.
// Effective price/mrp: use the product's own base_price/mrp when > 0, else fall
// back to the lowest active variant / sub-variant price (variant products carry
// base_price = 0, with the real price on the variants — same rule the admin
// product list uses for its "From Rs." display).
const BROCHURE_SELECT = `
  SELECT
    p.id, p.name, p.slug, p.sku, p.short_description, p.discount_pct,
    COALESCE(
      NULLIF(p.base_price, 0),
      (SELECT MIN(px) FROM (
        SELECT NULLIF(pv.price, 0) AS px FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        UNION ALL
        SELECT NULLIF(sv.price, 0) AS px FROM product_sub_variants sv
          WHERE sv.product_id = p.id AND sv.is_active = true
      ) q WHERE px IS NOT NULL)
    ) AS base_price,
    COALESCE(
      NULLIF(p.mrp, 0),
      (SELECT MIN(mx) FROM (
        SELECT NULLIF(pv.mrp, 0) AS mx FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        UNION ALL
        SELECT NULLIF(sv.mrp, 0) AS mx FROM product_sub_variants sv
          WHERE sv.product_id = p.id AND sv.is_active = true
      ) q WHERE mx IS NOT NULL)
    ) AS mrp,
    b.name AS brand_name,
    c.name AS category_name,
    (
      SELECT COALESCE(pi.thumbnail_url, pi.image_url)
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order ASC
      LIMIT 1
    ) AS thumbnail_url
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
`

/**
 * Products under the selected category subtrees (a parent auto-includes its
 * sub-categories via the recursive cat_tree) — regardless of brand. Backs the
 * categories-page brochure. Active products only.
 */
export async function getBrochureProductsByCategories(
  categoryIds: string[]
): Promise<BrochureProduct[]> {
  if (categoryIds.length === 0) return []
  return queryMany<BrochureProduct>(
    `
    WITH RECURSIVE cat_tree AS (
      SELECT id FROM categories WHERE id = ANY($1::uuid[])
      UNION ALL
      SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
    )
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.category_id IN (SELECT id FROM cat_tree)
    ORDER BY c.name ASC, p.name ASC
    `,
    [categoryIds]
  )
}

/**
 * Products for the selected brands — regardless of category. Backs the
 * brands-page brochure. Active products only.
 */
export async function getBrochureProductsByBrands(
  brandIds: string[]
): Promise<BrochureProduct[]> {
  if (brandIds.length === 0) return []
  return queryMany<BrochureProduct>(
    `
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.brand_id = ANY($1::uuid[])
    ORDER BY b.name ASC, p.name ASC
    `,
    [brandIds]
  )
}

/**
 * Products by explicit id list — the final admin selection (after deselecting in
 * the popup). Returned in the given id order so the PDF matches the preview.
 */
export async function getBrochureProductsByIds(
  productIds: string[]
): Promise<BrochureProduct[]> {
  if (productIds.length === 0) return []
  const rows = await queryMany<BrochureProduct>(
    `
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.id = ANY($1::uuid[])
    `,
    [productIds]
  )
  const byId = new Map(rows.map(r => [r.id, r]))
  return productIds.map(id => byId.get(id)).filter(Boolean) as BrochureProduct[]
}

export async function getFilteredCategories(filters: {
  is_active?: string
  type?: string
  search?: string
}) {
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

const CUSTOMER_SORT_COLS: Record<string, string> = {
  name: "u.first_name || ' ' || u.last_name",
  email: 'u.email',
  phone: 'u.phone',
  joined: 'u.created_at',
  orders: 'o.order_count',
  lifetime_value: 'o.lifetime_value',
}

export async function getCustomers(filters: {
  search?: string
  status?: string
  segment?: string
  tag?: string
  health?: string
  page?: number
  limit?: number
  sort?: string
  dir?: string
}) {
  const CUSTOMER_SORT_COLS: Record<string, string> = {
    name: "u.first_name || ' ' || u.last_name",
    email: 'u.email',
    phone: 'u.phone',
    joined: 'u.created_at',
    orders: 'o.order_count',
    lifetime_value: 'o.lifetime_value',
    status: 'u.is_active',
    health: 'COALESCE(ch.score, -1)',
  }

  const conditions: string[] = ['u.is_guest = false']
  const params: any[] = []
  let i = 1

  if (filters.status === 'active') {
    conditions.push(`u.is_active = true AND u.is_flagged = false`)
  } else if (filters.status === 'inactive') {
    conditions.push(`u.is_active = false AND u.is_flagged = false`)
  } else if (filters.status === 'flagged') {
    conditions.push(`u.is_flagged = true`)
  }

  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['u.email', 'u.first_name', 'u.last_name', 'u.phone'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  if (filters.tag) {
    conditions.push(`EXISTS (SELECT 1 FROM customer_tags ct WHERE ct.user_id = u.id AND ct.tag = $${i})`)
    params.push(filters.tag.toLowerCase())
    i++
  }

  if (filters.segment) {
    const seg = filters.segment
    if (seg === 'b2b') {
      conditions.push(`(cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL)`)
    } else if (seg === 'vip') {
      conditions.push(`COALESCE(o.lifetime_value, 0) >= 50000`)
    } else if (seg === 'loyal') {
      conditions.push(`COALESCE(o.paid_orders, 0) >= 5 AND COALESCE(o.lifetime_value, 0) >= 25000`)
    } else if (seg === 'repeat') {
      conditions.push(`COALESCE(o.order_count, 0) >= 3`)
    } else if (seg === 'one_time') {
      conditions.push(`COALESCE(o.order_count, 0) = 1`)
    } else if (seg === 'new') {
      conditions.push(`u.created_at >= NOW() - INTERVAL '30 days'`)
    } else if (seg === 'at_risk') {
      conditions.push(`o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '90 days' AND o.last_order_at >= NOW() - INTERVAL '180 days'`)
    } else if (seg === 'dormant') {
      conditions.push(`o.last_order_at IS NOT NULL AND o.last_order_at < NOW() - INTERVAL '180 days'`)
    } else if (seg === 'lead') {
      conditions.push(`COALESCE(o.order_count, 0) = 0`)
    }
  }

  if (filters.health === 'healthy') {
    conditions.push(`ch.score >= 70`)
  } else if (filters.health === 'at_risk') {
    conditions.push(`ch.score >= 40 AND ch.score < 70`)
  } else if (filters.health === 'critical') {
    conditions.push(`ch.score IS NOT NULL AND ch.score < 40`)
  } else if (filters.health === 'unknown') {
    conditions.push(`ch.score IS NULL`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const limit = filters.limit || 50
  const offset = ((filters.page || 1) - 1) * limit
  const sortCol = CUSTOMER_SORT_COLS[filters.sort || ''] || 'u.created_at'
  const sortDir = filters.dir === 'asc' ? 'ASC' : 'DESC'

  const safeCol = (filters.sort && CUSTOMER_SORT_COLS[filters.sort]) ? CUSTOMER_SORT_COLS[filters.sort] : 'u.created_at'
  const safeDir = filters.dir === 'asc' ? 'ASC' : 'DESC'

  const [customers, total] = await Promise.all([
    queryMany(`
      SELECT
        u.id, u.email, u.phone, u.first_name, u.last_name,
        u.is_active, u.is_flagged, u.flag_reason, u.created_at,
        u.user_type,
        cp.customer_type,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.lifetime_value, 0) AS lifetime_value,
        o.last_order_at,
        ch.score AS health_score,
        ch.churn_risk,
        ch.trend_delta_30d,
        COALESCE(
          (SELECT array_agg(ct.tag ORDER BY ct.created_at DESC) FROM customer_tags ct WHERE ct.user_id = u.id),
          ARRAY[]::varchar[]
        ) AS tags,
        bp.company_name AS bp_company_name,
        bp.approval_status AS bp_approval_status,
        bp.gst_number AS bp_gst_number,
        bp.industry AS bp_industry
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN customer_health ch ON ch.user_id = u.id
      LEFT JOIN business_profiles bp ON bp.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               MAX(created_at) AS last_order_at,
               SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON u.id = o.user_id
      ${where}
      ORDER BY ${safeCol} ${safeDir}
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]),
    queryCount(`
      SELECT COUNT(*) FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN customer_health ch ON ch.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               MAX(created_at) AS last_order_at,
               SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON u.id = o.user_id
      ${where}
    `, params),
  ])

  return { customers, total }
}

export async function getCustomerById(id: string) {
  const customer = await queryOne(`
    SELECT
      u.id, u.email, u.phone, u.first_name, u.last_name,
      u.is_active, u.is_flagged, u.flag_reason, u.created_at,
      u.user_type, u.notification_channel, u.marketing_opt_out,
      cp.customer_type, cp.company_name, cp.gst_number, cp.credit_limit,
      bp.company_name AS bp_company_name,
      bp.approval_status AS bp_approval_status,
      bp.gst_number AS bp_gst_number,
      bp.industry AS bp_industry,
      bp.business_address AS bp_business_address,
      bp.created_at AS bp_created_at,
      bp.approved_at AS bp_approved_at,
      bp.rejection_note AS bp_rejection_note
    FROM users u
    LEFT JOIN customer_profiles cp ON u.id = cp.user_id
    LEFT JOIN business_profiles bp ON bp.user_id = u.id
    WHERE u.id = $1 AND u.is_guest = false
  `, [id])

  if (!customer) throw new Error('Customer not found')

  const recentOrders = await queryMany(`
    SELECT id, order_number, total_amount, status, payment_status, created_at
    FROM orders
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [id])

  const stats = await queryOne<{
    total_orders: string
    lifetime_value: string
    last_order_at: string | null
    paid_orders: string
  }>(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(total_amount), 0) AS lifetime_value,
      MAX(created_at) AS last_order_at,
      COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders
    FROM orders
    WHERE user_id = $1
  `, [id])

  const tags = await queryMany<{ id: string; tag: string; created_at: string }>(`
    SELECT id, tag, created_at FROM customer_tags WHERE user_id = $1 ORDER BY created_at DESC
  `, [id])

  const notes = await queryMany<{
    id: string; body: string; created_at: string;
    admin_username: string | null; admin_first_name: string | null; admin_last_name: string | null
  }>(`
    SELECT n.id, n.body, n.created_at,
           COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.email) AS admin_username, u.first_name AS admin_first_name, u.last_name AS admin_last_name
    FROM customer_notes n
    LEFT JOIN admins a ON n.admin_id = a.id
    LEFT JOIN users u ON a.user_id = u.id
    WHERE n.user_id = $1
    ORDER BY n.created_at DESC
    LIMIT 50
  `, [id])

  const totalOrders = parseInt(stats?.total_orders ?? '0')
  const lifetimeValue = parseFloat(stats?.lifetime_value ?? '0')
  const paidOrders = parseInt(stats?.paid_orders ?? '0')
  const lastOrderAt = stats?.last_order_at ? new Date(stats.last_order_at) : null
  const createdAt = customer.created_at ? new Date(customer.created_at) : null
  const now = new Date()
  const daysSinceLastOrder = lastOrderAt ? Math.floor((now.getTime() - lastOrderAt.getTime()) / 86400000) : null
  const daysSinceJoined = createdAt ? Math.floor((now.getTime() - createdAt.getTime()) / 86400000) : null

  const segments: string[] = []
  if (customer.gst_number || customer.company_name) segments.push('b2b')
  if (lifetimeValue >= 50000) segments.push('vip')
  if (totalOrders >= 3) segments.push('repeat')
  if (totalOrders === 1) segments.push('one_time')
  if (daysSinceJoined !== null && daysSinceJoined <= 30) segments.push('new')
  if (daysSinceLastOrder !== null && daysSinceLastOrder >= 90 && daysSinceLastOrder < 180) segments.push('at_risk')
  if (daysSinceLastOrder !== null && daysSinceLastOrder >= 180) segments.push('dormant')
  if (totalOrders === 0) segments.push('lead')
  if (paidOrders >= 5 && lifetimeValue >= 25000) segments.push('loyal')

  const health = await queryOne<{
    score: number; recency_score: number; frequency_score: number;
    monetary_score: number; engagement_score: number; satisfaction_score: number;
    churn_risk: string; trend_delta_7d: number; trend_delta_30d: number;
    last_computed_at: string;
  }>(`
    SELECT score, recency_score, frequency_score, monetary_score, engagement_score, satisfaction_score,
           churn_risk, trend_delta_7d, trend_delta_30d, last_computed_at::text AS last_computed_at
    FROM customer_health WHERE user_id = $1
  `, [id])

  const assignedCoupons = await queryMany<{
    id: string; code: string; discount_type: string; discount_value: number;
    valid_until: string | null; times_used: number; description: string | null;
  }>(`
    SELECT DISTINCT ON (c.id) c.id, c.code, c.discount_type, c.discount_value, c.valid_until, c.times_used, c.description
    FROM coupons c
    WHERE c.is_active = true
      AND (c.valid_until IS NULL OR c.valid_until > NOW())
      AND (
        c.generated_for_user_id = $1
        OR EXISTS (SELECT 1 FROM coupon_eligible_users ceu WHERE ceu.coupon_id = c.id AND ceu.user_id = $1)
      )
    ORDER BY c.id, c.created_at DESC
  `, [id])

  return {
    ...customer,
    recent_orders: recentOrders,
    total_orders: totalOrders,
    lifetime_value: lifetimeValue,
    last_order_at: stats?.last_order_at ?? null,
    days_since_last_order: daysSinceLastOrder,
    paid_orders: paidOrders,
    tags,
    notes,
    segments,
    health,
    assigned_coupons: assignedCoupons,
  }
}

export async function getRecentOrders(limit: number = 10) {
  return queryMany('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1', [limit])
}

export async function getDashboardMetrics() {
  const [
    periodRevenue,
    orderFunnel,
    topProducts,
    recentOrders,
  ] = await Promise.all([
    queryOne<{
      this_month_revenue: string; last_month_revenue: string
      this_month_orders: string; last_month_orders: string
      this_month_customers: string; last_month_customers: string
      today_revenue: string; yesterday_revenue: string
      online_revenue: string; offline_revenue: string
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS this_month_revenue,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW() - INTERVAL '1 month') AND created_at < date_trunc('month', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS last_month_revenue,
        COUNT(CASE WHEN created_at >= date_trunc('month', NOW()) THEN 1 END) AS this_month_orders,
        COUNT(CASE WHEN created_at >= date_trunc('month', NOW() - INTERVAL '1 month') AND created_at < date_trunc('month', NOW()) THEN 1 END) AS last_month_orders,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS today_revenue,
        COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW() - INTERVAL '1 day') AND created_at < date_trunc('day', NOW()) AND payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS yesterday_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND source = 'online' THEN total_amount ELSE 0 END), 0) AS online_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' AND source = 'offline' THEN total_amount ELSE 0 END), 0) AS offline_revenue
      FROM orders
    `),
    queryOne<{
      pending: string; processing: string; shipped: string
      out_for_delivery: string; delivered: string; cancelled: string
    }>(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status IN ('confirmed','processing') THEN 1 END) AS processing,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) AS shipped,
        COUNT(CASE WHEN status = 'out_for_delivery' THEN 1 END) AS out_for_delivery,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled
      FROM orders
    `),
    queryMany<{ product_id: string; name: string; total_qty: string; total_revenue: string }>(`
      SELECT
        oi.product_id,
        p.name,
        SUM(oi.quantity) AS total_qty,
        SUM(oi.total_price) AS total_revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= date_trunc('month', NOW())
      GROUP BY oi.product_id, p.name
      ORDER BY total_qty DESC
      LIMIT 5
    `),
    queryMany(`
      SELECT
        o.id, o.order_number, o.customer_name, o.total_amount,
        o.status, o.payment_status, o.source, o.created_at,
        json_build_object(
          'id', u.id, 'email', u.email,
          'first_name', u.first_name, 'last_name', u.last_name
        ) AS users
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 5
    `),
  ])

  const pct = (a: number, b: number) => b === 0 ? null : Math.round(((a - b) / b) * 100)

  const thisRevenue = parseFloat(periodRevenue?.this_month_revenue || '0')
  const lastRevenue = parseFloat(periodRevenue?.last_month_revenue || '0')
  const thisOrders = parseInt(periodRevenue?.this_month_orders || '0')
  const lastOrders = parseInt(periodRevenue?.last_month_orders || '0')
  const todayRevenue = parseFloat(periodRevenue?.today_revenue || '0')
  const yesterdayRevenue = parseFloat(periodRevenue?.yesterday_revenue || '0')
  const onlineRevenue = parseFloat(periodRevenue?.online_revenue || '0')
  const offlineRevenue = parseFloat(periodRevenue?.offline_revenue || '0')

  return {
    revenue: {
      thisMonth: thisRevenue,
      lastMonth: lastRevenue,
      pctChange: pct(thisRevenue, lastRevenue),
      today: todayRevenue,
      yesterday: yesterdayRevenue,
      todayPct: pct(todayRevenue, yesterdayRevenue),
      online: onlineRevenue,
      offline: offlineRevenue,
      total: onlineRevenue + offlineRevenue,
    },
    orders: {
      thisMonth: thisOrders,
      lastMonth: lastOrders,
      pctChange: pct(thisOrders, lastOrders),
    },
    funnel: {
      pending: parseInt(orderFunnel?.pending || '0'),
      processing: parseInt(orderFunnel?.processing || '0'),
      shipped: parseInt(orderFunnel?.shipped || '0'),
      outForDelivery: parseInt(orderFunnel?.out_for_delivery || '0'),
      delivered: parseInt(orderFunnel?.delivered || '0'),
      cancelled: parseInt(orderFunnel?.cancelled || '0'),
    },
    topProducts: topProducts.map(p => ({
      id: p.product_id,
      name: p.name,
      qty: parseInt(p.total_qty),
      revenue: parseFloat(p.total_revenue),
    })),
    recentOrders,
  }
}

export async function getOrder(id: string) {
  const order = await queryOne(`
    SELECT
      o.*,
      json_build_object(
        'id', u.id, 'email', u.email, 'first_name', u.first_name,
        'last_name', u.last_name, 'phone', u.phone
      ) AS users,
      COALESCE(
        (SELECT json_agg(
          json_build_object(
            'id', oi.id, 'order_id', oi.order_id, 'product_id', oi.product_id,
            'product_name', oi.product_name, 'product_sku', oi.product_sku,
            'variant_name', oi.variant_name, 'quantity', oi.quantity,
            'unit_price', oi.unit_price, 'discount_amount', oi.discount_amount,
            'tax_amount', oi.tax_amount, 'total_price', oi.total_price,
            'buy_mode', oi.buy_mode, 'buy_unit', oi.buy_unit,
            'created_at', oi.created_at,
            'variant_id', oi.variant_id,
            'sub_variant_id', oi.sub_variant_id,
            'sell_unit_factor', (SELECT pu.factor FROM product_units pu WHERE pu.unit = oi.buy_unit AND pu.product_id = oi.product_id LIMIT 1),
            'sell_unit_dimension', (SELECT pu.dimension FROM product_units pu WHERE pu.unit = oi.buy_unit AND pu.product_id = oi.product_id LIMIT 1),
            'products', json_build_object(
              'id', pr.id, 'name', pr.name, 'sku', pr.sku,
              'slug', pr.slug,
              'inventory_quantity', pr.inventory_quantity,
              'extra_delivery_days', pr.extra_delivery_days,
              'image_url', (SELECT COALESCE(pi2.thumbnail_url, pi2.image_url) FROM product_images pi2 WHERE pi2.product_id = pr.id AND pi2.is_primary = true LIMIT 1)
            ),
            'variant', CASE WHEN oi.variant_id IS NOT NULL THEN
              json_build_object(
                'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
                'inventory_quantity', CASE
                  WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
                  THEN COALESCE((SELECT SUM(sv2.inventory_quantity) FROM product_sub_variants sv2 WHERE sv2.variant_id = pv.id AND sv2.is_active = true), 0)
                  ELSE pv.inventory_quantity
                END
              )
            ELSE NULL END,
            'sub_variant', CASE WHEN oi.sub_variant_id IS NOT NULL THEN
              json_build_object(
                'id', psv.id, 'sub_variant_name', psv.sub_variant_name, 'sku', psv.sku,
                'inventory_quantity', psv.inventory_quantity
              )
            ELSE NULL END
          )
        )
        FROM order_items oi
        LEFT JOIN products pr ON oi.product_id = pr.id
        LEFT JOIN product_variants pv ON oi.variant_id = pv.id
        LEFT JOIN product_sub_variants psv ON oi.sub_variant_id = psv.id
        WHERE oi.order_id = o.id),
        '[]'::json
      ) AS order_items,
      COALESCE(
        (SELECT row_to_json(sa) FROM addresses sa WHERE sa.id = o.shipping_address_id),
        o.shipping_address_snapshot::json
      ) AS shipping_address,
      COALESCE(
        (SELECT row_to_json(ba) FROM addresses ba WHERE ba.id = o.billing_address_id),
        o.billing_address_snapshot::json
      ) AS billing_address,
      COALESCE(
        (SELECT json_agg(pay) FROM payments pay WHERE pay.order_id = o.id),
        '[]'::json
      ) AS payments,
      orig.order_number AS original_order_number
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN orders orig ON orig.id = o.original_order_id
    WHERE o.id = $1
  `, [id])

  if (!order) throw new Error('Order not found')
  return order
}

export async function getReturnRequest(orderId: string) {
  const returnRequest = await queryOne(`
    SELECT rr.*, o2.order_number AS replacement_order_number,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'id', rri.id,
          'order_item_id', rri.order_item_id,
          'product_id', rri.product_id,
          'variant_id', rri.variant_id,
          'quantity', rri.quantity,
          'unit_price', rri.unit_price,
          'refund_amount', rri.refund_amount,
          'product_name', rri.product_name,
          'variant_name', rri.variant_name
        ) ORDER BY rri.created_at)
        FROM return_request_items rri WHERE rri.return_request_id = rr.id),
        '[]'::json
      ) AS items
    FROM return_requests rr
    LEFT JOIN orders o2 ON o2.id = rr.replacement_order_id
    WHERE rr.order_id = $1
    ORDER BY rr.created_at DESC
    LIMIT 1
  `, [orderId])
  return returnRequest || null
}

// ── Dashboard analytics (range-aware) ────────────────────────────────────────

export type AnalyticsRange = 'today' | '7d' | '30d' | '90d' | 'month' | 'year'

/** Map a range key → an interval string + the trend bucket granularity. */
function rangeConfig(range: AnalyticsRange): { interval: string; bucket: 'hour' | 'day' | 'week' | 'month'; label: string } {
  switch (range) {
    case 'today': return { interval: '1 day', bucket: 'hour', label: 'Today' }
    case '7d':    return { interval: '7 days', bucket: 'day', label: 'Last 7 days' }
    case '30d':   return { interval: '30 days', bucket: 'day', label: 'Last 30 days' }
    case '90d':   return { interval: '90 days', bucket: 'week', label: 'Last 90 days' }
    case 'month': return { interval: '1 month', bucket: 'day', label: 'This month' }
    case 'year':  return { interval: '1 year', bucket: 'month', label: 'Last 12 months' }
    default:      return { interval: '30 days', bucket: 'day', label: 'Last 30 days' }
  }
}

const num = (v: unknown) => (v == null ? 0 : parseFloat(String(v)) || 0)
const int = (v: unknown) => (v == null ? 0 : parseInt(String(v), 10) || 0)
const pctDelta = (a: number, b: number): number | null => (b === 0 ? null : Math.round(((a - b) / b) * 100))

export interface DashboardAnalytics {
  range: AnalyticsRange
  rangeLabel: string
  kpis: {
    revenue: number; revenuePrev: number; revenuePct: number | null
    orders: number; ordersPrev: number; ordersPct: number | null
    aov: number; aovPrev: number; aovPct: number | null
    customers: number; customersPrev: number; customersPct: number | null
  }
  trend: { bucket: string; label: string; revenue: number; orders: number; paidOrders: number; customers: number; units: number; aov: number }[]
  payment: { online: number; cod: number; other: number; codOutstanding: number; codOutstandingCount: number }
  topCategories: { name: string; units: number; revenue: number }[]
  topBrands: { name: string; units: number; revenue: number }[]
  customerSplit: { newCustomers: number; returningCustomers: number }
  buyerSplit: { business: number; consumer: number; businessRevenue: number; consumerRevenue: number }
  inventory: { inStock: number; lowStock: number; outOfStock: number; stockValue: number }
  returns: { total: number; rtoInTransit: number; rtoDelivered: number }
  insights: DashboardInsights
}

/**
 * Range-aware commerce analytics for the admin dashboard. Only counts revenue on
 * paid orders; order counts include all statuses. Compares to the immediately
 * preceding equal-length window for deltas. All columns verified against schema.
 */
export async function getDashboardAnalytics(range: AnalyticsRange = '30d'): Promise<DashboardAnalytics> {
  const { interval, bucket, label } = rangeConfig(range)
  // For 'month'/'year' anchor to calendar boundaries; else rolling window.
  const startExpr = range === 'month'
    ? `date_trunc('month', NOW())`
    : range === 'year'
      ? `date_trunc('month', NOW()) - INTERVAL '11 months'`
      : `NOW() - INTERVAL '${interval}'`
  const prevStartExpr = range === 'month'
    ? `date_trunc('month', NOW() - INTERVAL '1 month')`
    : range === 'year'
      ? `date_trunc('month', NOW()) - INTERVAL '23 months'`
      : `NOW() - INTERVAL '${interval}' - INTERVAL '${interval}'`
  const prevEndExpr = range === 'month' ? `date_trunc('month', NOW())` : `NOW() - INTERVAL '${interval}'`

  const kpiPromise = queryOne<Record<string, string>>(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE created_at >= ${startExpr} AND payment_status = 'paid'), 0) AS rev,
        COALESCE(SUM(total_amount) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr} AND payment_status = 'paid'), 0) AS rev_prev,
        COUNT(*) FILTER (WHERE created_at >= ${startExpr}) AS ord,
        COUNT(*) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr}) AS ord_prev,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${startExpr}) AS cust,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= ${prevStartExpr} AND created_at < ${prevEndExpr}) AS cust_prev
      FROM orders
    `)
  const paidRevenue = kpiPromise.then(r => ({ revenue: num(r?.rev), revenuePrev: num(r?.rev_prev) }))

  const [kpiRow, trendRows, payRow, topCats, topBrandsRows, custSplit, buyerRow, invRow, retRow, insights] = await Promise.all([
    kpiPromise,
    // Trend series over the range. Two aggregations joined by bucket so the
    // order_items fan-out doesn't inflate order-level sums (revenue/counts).
    queryMany<Record<string, string>>(`
      WITH ord AS (
        SELECT date_trunc('${bucket}', created_at) AS bucket,
               COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) AS revenue,
               COUNT(*) AS orders,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               COUNT(DISTINCT user_id) AS customers
        FROM orders WHERE created_at >= ${startExpr}
        GROUP BY 1
      ),
      itm AS (
        SELECT date_trunc('${bucket}', o.created_at) AS bucket, COALESCE(SUM(oi.quantity), 0) AS units
        FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.created_at >= ${startExpr}
        GROUP BY 1
      )
      SELECT ord.bucket, ord.revenue, ord.orders, ord.paid_orders, ord.customers,
             COALESCE(itm.units, 0) AS units
      FROM ord LEFT JOIN itm ON itm.bucket = ord.bucket
      ORDER BY ord.bucket ASC
    `),
    // Payment split + COD outstanding
    queryOne<Record<string, string>>(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode NOT ILIKE '%cod%'), 0) AS online,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode ILIKE '%cod%'), 0) AS cod,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid' AND payment_mode IS NULL), 0) AS other,
        COALESCE(SUM(total_amount) FILTER (WHERE payment_mode ILIKE '%cod%' AND payment_status <> 'paid' AND status NOT IN ('cancelled','returned')), 0) AS cod_outstanding,
        COUNT(*) FILTER (WHERE payment_mode ILIKE '%cod%' AND payment_status <> 'paid' AND status NOT IN ('cancelled','returned')) AS cod_outstanding_count
      FROM orders
      WHERE created_at >= ${startExpr}
    `),
    // Top categories
    queryMany<Record<string, string>>(`
      SELECT c.name AS name, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE o.created_at >= ${startExpr}
      GROUP BY c.name ORDER BY revenue DESC LIMIT 6
    `),
    // Top brands
    queryMany<Record<string, string>>(`
      SELECT b.name AS name, SUM(oi.quantity) AS units, SUM(oi.total_price) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      JOIN brands b ON b.id = p.brand_id
      WHERE o.created_at >= ${startExpr}
      GROUP BY b.name ORDER BY revenue DESC LIMIT 6
    `),
    // New vs returning customers in range (based on first-ever order date)
    queryOne<Record<string, string>>(`
      WITH firsts AS (
        SELECT user_id, MIN(created_at) AS first_order FROM orders WHERE user_id IS NOT NULL GROUP BY user_id
      ), in_range AS (
        SELECT DISTINCT o.user_id FROM orders o WHERE o.created_at >= ${startExpr} AND o.user_id IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE f.first_order >= ${startExpr}) AS new_cust,
        COUNT(*) FILTER (WHERE f.first_order < ${startExpr}) AS returning_cust
      FROM in_range ir JOIN firsts f ON f.user_id = ir.user_id
    `),
    // Business vs consumer (by orders in range; B2B = GSTIN present or business discount)
    queryOne<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE buyer_gstin IS NOT NULL AND buyer_gstin <> '' OR business_discount_amount > 0) AS business,
        COUNT(*) FILTER (WHERE (buyer_gstin IS NULL OR buyer_gstin = '') AND business_discount_amount = 0) AS consumer,
        COALESCE(SUM(total_amount) FILTER (WHERE (buyer_gstin IS NOT NULL AND buyer_gstin <> '') OR business_discount_amount > 0), 0) AS business_rev,
        COALESCE(SUM(total_amount) FILTER (WHERE (buyer_gstin IS NULL OR buyer_gstin = '') AND business_discount_amount = 0), 0) AS consumer_rev
      FROM orders WHERE created_at >= ${startExpr} AND payment_status = 'paid'
    `),
    // Inventory health (active products) + real stock value from variants/sub-variants
    queryOne<Record<string, string>>(`
      SELECT
        COUNT(*) FILTER (WHERE stock_status = 'In Stock') AS in_stock,
        COUNT(*) FILTER (WHERE stock_status = 'Low Stock') AS low_stock,
        COUNT(*) FILTER (WHERE stock_status = 'Out of Stock') AS out_of_stock,
        COALESCE((
          SELECT SUM(
            COALESCE(pv.inventory_quantity, 0) *
            COALESCE(NULLIF(pv.cost_price,0), NULLIF(pv.price,0), NULLIF(p2.cost_price,0), NULLIF(p2.base_price,0), 0)
          )
          FROM product_variants pv
          JOIN products p2 ON p2.id = pv.product_id
          WHERE p2.is_active = true AND pv.is_active = true
            AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
        ), 0) +
        COALESCE((
          SELECT SUM(
            COALESCE(sv.inventory_quantity, 0) *
            COALESCE(NULLIF(sv.price,0), NULLIF(p3.cost_price,0), NULLIF(p3.base_price,0), 0)
          )
          FROM product_sub_variants sv
          JOIN product_variants pv2 ON pv2.id = sv.variant_id
          JOIN products p3 ON p3.id = pv2.product_id
          WHERE p3.is_active = true AND sv.is_active = true
        ), 0) +
        COALESCE((
          SELECT SUM(
            COALESCE(inventory_quantity, 0) *
            COALESCE(NULLIF(cost_price,0), NULLIF(base_price,0), 0)
          )
          FROM products
          WHERE is_active = true AND has_variants = false
        ), 0) AS stock_value
      FROM products WHERE is_active = true
    `),
    // Returns / RTO
    queryOne<Record<string, string>>(`
      SELECT
        (SELECT COUNT(*) FROM return_requests WHERE created_at >= ${startExpr}) AS total_returns,
        COUNT(*) FILTER (WHERE shipment_status IN ('rto_initiated','rto_in_transit','rto_out_for_return')) AS rto_in_transit,
        COUNT(*) FILTER (WHERE shipment_status = 'rto_delivered') AS rto_delivered
      FROM orders WHERE created_at >= ${startExpr}
    `),
    getDashboardInsights({ startExpr, prevStartExpr, prevEndExpr, days: rangeDays(range) }, paidRevenue),
  ])

  const rev = num(kpiRow?.rev), revPrev = num(kpiRow?.rev_prev)
  const ord = int(kpiRow?.ord), ordPrev = int(kpiRow?.ord_prev)
  const cust = int(kpiRow?.cust), custPrev = int(kpiRow?.cust_prev)
  const aov = ord > 0 ? rev / ord : 0
  const aovPrev = ordPrev > 0 ? revPrev / ordPrev : 0

  return {
    range,
    rangeLabel: label,
    kpis: {
      revenue: rev, revenuePrev: revPrev, revenuePct: pctDelta(rev, revPrev),
      orders: ord, ordersPrev: ordPrev, ordersPct: pctDelta(ord, ordPrev),
      aov: Math.round(aov), aovPrev: Math.round(aovPrev), aovPct: pctDelta(aov, aovPrev),
      customers: cust, customersPrev: custPrev, customersPct: pctDelta(cust, custPrev),
    },
    trend: trendRows.map(r => {
      const revenue = num(r.revenue)
      const paidOrders = int(r.paid_orders)
      return {
        bucket: String(r.bucket),
        label: String(r.bucket),
        revenue,
        orders: int(r.orders),
        paidOrders,
        customers: int(r.customers),
        units: int(r.units),
        aov: paidOrders > 0 ? Math.round(revenue / paidOrders) : 0,
      }
    }),
    payment: {
      online: num(payRow?.online),
      cod: num(payRow?.cod),
      other: num(payRow?.other),
      codOutstanding: num(payRow?.cod_outstanding),
      codOutstandingCount: int(payRow?.cod_outstanding_count),
    },
    topCategories: topCats.map(c => ({ name: c.name || 'Uncategorized', units: num(c.units), revenue: num(c.revenue) })),
    topBrands: topBrandsRows.map(b => ({ name: b.name || 'No brand', units: num(b.units), revenue: num(b.revenue) })),
    customerSplit: { newCustomers: int(custSplit?.new_cust), returningCustomers: int(custSplit?.returning_cust) },
    buyerSplit: {
      business: int(buyerRow?.business), consumer: int(buyerRow?.consumer),
      businessRevenue: num(buyerRow?.business_rev), consumerRevenue: num(buyerRow?.consumer_rev),
    },
    inventory: {
      inStock: int(invRow?.in_stock), lowStock: int(invRow?.low_stock),
      outOfStock: int(invRow?.out_of_stock), stockValue: num(invRow?.stock_value),
    },
    returns: {
      total: int(retRow?.total_returns), rtoInTransit: int(retRow?.rto_in_transit), rtoDelivered: int(retRow?.rto_delivered),
    },
    insights,
  }
}

// Monthly paid-revenue trend split by order source (last 12 months). Pivoted server-side into
// one continuous (zero-filled) points array per source, aligned to a shared months axis.
export interface RevenueTrend {
  months: string[]
  series: Array<{ source: string; label: string; color: string; points: number[] }>
}

const REVENUE_SOURCES: Array<{ source: string; label: string; color: string }> = [
  { source: 'online', label: 'Online', color: '#3b82f6' },      // blue
  { source: 'business', label: 'Business', color: '#22c55e' },  // green
  { source: 'offline', label: 'Offline', color: '#a855f7' },    // purple
  { source: 'cash_sale', label: 'Cash Sale', color: '#f59e0b' },// amber
]

export type RevenuePeriod = '3m' | '6m' | '12m' | 'ytd' | 'all'

// Monthly paid-revenue trend split by order source, for the requested period. Pivoted
// server-side into one continuous (zero-filled) points array per source, aligned to a shared
// months axis.
export async function getRevenueTrendBySource(period: RevenuePeriod = '12m'): Promise<RevenueTrend> {
  // Resolve the window's start month (inclusive) as a Date at day 1.
  const now = new Date()
  const startOfMonth = (y: number, m: number) => new Date(y, m, 1)
  let start: Date
  if (period === '3m') start = startOfMonth(now.getFullYear(), now.getMonth() - 2)
  else if (period === '6m') start = startOfMonth(now.getFullYear(), now.getMonth() - 5)
  else if (period === 'ytd') start = startOfMonth(now.getFullYear(), 0)
  else if (period === 'all') start = new Date(0) // resolved to first-order month below
  else start = startOfMonth(now.getFullYear(), now.getMonth() - 11) // 12m default

  // For 'all', anchor the axis to the earliest paid order.
  if (period === 'all') {
    const first = await queryOne<{ m: string }>(
      `SELECT to_char(date_trunc('month', min(created_at)), 'YYYY-MM') AS m
         FROM orders WHERE payment_status = 'paid'`
    ).catch(() => null)
    if (first?.m) {
      const [y, mm] = first.m.split('-').map(Number)
      start = startOfMonth(y, mm - 1)
    } else {
      start = startOfMonth(now.getFullYear(), now.getMonth() - 11)
    }
  }

  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  const rows = await queryMany<{ month: string; source: string; revenue: number }>(`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
           source,
           SUM(total_amount)::float AS revenue
      FROM orders
     WHERE payment_status = 'paid'
       AND created_at >= $1::date
     GROUP BY 1, 2
     ORDER BY 1
  `, [startStr]).catch(() => [])

  // Continuous month axis from `start` through the current month.
  const months: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const monthIndex = new Map(months.map((m, idx) => [m, idx]))

  const bySource = new Map<string, number[]>()
  for (const s of REVENUE_SOURCES) bySource.set(s.source, new Array(months.length).fill(0))
  for (const r of rows) {
    const arr = bySource.get(r.source)
    const idx = monthIndex.get(r.month)
    if (arr && idx !== undefined) arr[idx] = Number(r.revenue) || 0
  }

  const series = REVENUE_SOURCES.map(s => ({ ...s, points: bySource.get(s.source)! }))
  return { months, series }
}

export interface BreakdownSlice { label: string; value: number; color: string }

export interface ProductStats {
  totalProducts: number
  activeProducts: number
  featured: number
  categories: number
  inventoryValue: number       // Σ (price × inventory_quantity): variants for has_variants, base for simple
  byCategory: BreakdownSlice[]
  byBrand: BreakdownSlice[]
  byStock: BreakdownSlice[]
  byInventoryValue: BreakdownSlice[]   // Σ base_price split by stock status (₹)
}

// Categorical palette for the product breakdown bars (brand-neutral, light/dark safe).
const BREAKDOWN_PALETTE = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#f97316',
]

// Cap a grouped result to top-N slices + an aggregated "Other" bucket, and colorize.
function toSlices(rows: Array<{ label: string | null; count: number }>, topN = 8): BreakdownSlice[] {
  const cleaned = rows.map(r => ({ label: r.label || 'Uncategorized', value: Number(r.count) || 0 }))
  const top = cleaned.slice(0, topN)
  const rest = cleaned.slice(topN)
  if (rest.length) top.push({ label: 'Other', value: rest.reduce((s, r) => s + r.value, 0) })
  return top.map((s, i) => ({ ...s, color: BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length] }))
}

// All the header metrics + three categorical breakdowns for the Products page, in one call.
export async function getProductBreakdowns(): Promise<ProductStats> {
  const [summary, invValue, catRows, brandRows, stockRows, invValueRows] = await Promise.all([
    queryOne<{ total: number; active: number; featured: number; categories: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active)::int AS active,
        COUNT(*) FILTER (WHERE is_featured)::int AS featured,
        (SELECT COUNT(*)::int FROM categories WHERE is_active) AS categories
      FROM products
      WHERE is_draft = false
    `),
    // True inventory stock value — reuse the canonical valuation (ex-GST, covers products +
    // variants + sub-variants) so this matches the Stock Ledger → Valuation page exactly.
    getStockValuation().then(v => ({ inv_value: v.totalValue })).catch(() => ({ inv_value: 0 })),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(top.name, 'Uncategorized') AS label, COUNT(*)::int AS count
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN categories top ON top.id = COALESCE(c.parent_category_id, c.id)
       WHERE p.is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(b.name, 'No Brand') AS label, COUNT(*)::int AS count
        FROM products p LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    queryMany<{ label: string | null; count: number }>(`
      SELECT COALESCE(stock_status, 'Unknown') AS label, COUNT(*)::int AS count
        FROM products WHERE is_active
       GROUP BY 1 ORDER BY 2 DESC
    `),
    // Top products by catalog value (base_price) — the "Inventory Value" breakdown.
    queryMany<{ label: string | null; count: number }>(`
      SELECT name AS label, COALESCE(base_price, 0)::float AS count
        FROM products WHERE is_active AND base_price > 0
       ORDER BY base_price DESC
       LIMIT 10
    `),
  ])

  return {
    totalProducts: Number(summary?.total) || 0,
    activeProducts: Number(summary?.active) || 0,
    featured: Number(summary?.featured) || 0,
    categories: Number(summary?.categories) || 0,
    inventoryValue: Number(invValue?.inv_value) || 0,
    byCategory: toSlices(catRows),
    byBrand: toSlices(brandRows),
    byStock: toSlices(stockRows, 5),
    byInventoryValue: invValueRows.map((r, i) => ({
      label: r.label || 'Unnamed',
      value: Number(r.count) || 0,
      color: BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length],
    })),
  }
}

// ── Customer stats + engagement (admin /customers page) ──────────────────────

export interface CustomerStats {
  total: number
  active: number
  inactive: number
  flagged: number
}

// Real COUNT-based stats over all non-guest customers (matches getCustomers' filter).
export async function getCustomerStats(): Promise<CustomerStats> {
  const row = await queryOne<CustomerStats>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_active AND NOT is_flagged)::int AS active,
      COUNT(*) FILTER (WHERE NOT is_active AND NOT is_flagged)::int AS inactive,
      COUNT(*) FILTER (WHERE is_flagged)::int AS flagged
    FROM users
    WHERE is_guest = false
  `)
  return row ?? { total: 0, active: 0, inactive: 0, flagged: 0 }
}

// Engagement segments (VIP / loyal / repeat / one-time / new / at-risk / dormant / lead)
// derived from order history — mirrors the CRM segment SQL.
export async function getCustomerSegments(): Promise<BreakdownSlice[]> {
  const row = await queryOne<{
    vip: number; loyal: number; repeat: number; one_time: number;
    new: number; at_risk: number; dormant: number; lead: number;
  }>(`
    WITH agg AS (
      SELECT
        u.id, u.created_at,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.paid_orders, 0) AS paid_orders,
        COALESCE(o.lifetime_value, 0) AS ltv,
        o.last_order_at
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               COUNT(*) AS order_count,
               COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               SUM(total_amount) AS lifetime_value,
               MAX(created_at) AS last_order_at
        FROM orders GROUP BY user_id
      ) o ON o.user_id = u.id
      WHERE u.is_guest = false
    )
    SELECT
      COUNT(*) FILTER (WHERE ltv >= 50000)::int AS vip,
      COUNT(*) FILTER (WHERE paid_orders >= 5 AND ltv >= 25000)::int AS loyal,
      COUNT(*) FILTER (WHERE order_count >= 3)::int AS repeat,
      COUNT(*) FILTER (WHERE order_count = 1)::int AS one_time,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new,
      COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '90 days' AND last_order_at >= NOW() - INTERVAL '180 days')::int AS at_risk,
      COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '180 days')::int AS dormant,
      COUNT(*) FILTER (WHERE order_count = 0)::int AS lead
    FROM agg
  `)
  const s = row ?? { vip: 0, loyal: 0, repeat: 0, one_time: 0, new: 0, at_risk: 0, dormant: 0, lead: 0 }
  return [
    { label: 'VIP', value: s.vip, color: '#8b5cf6' },
    { label: 'Loyal', value: s.loyal, color: '#3b82f6' },
    { label: 'Repeat', value: s.repeat, color: '#10b981' },
    { label: 'One-time', value: s.one_time, color: '#14b8a6' },
    { label: 'New', value: s.new, color: '#22c55e' },
    { label: 'At risk', value: s.at_risk, color: '#f59e0b' },
    { label: 'Dormant', value: s.dormant, color: '#ef4444' },
    { label: 'Lead', value: s.lead, color: '#94a3b8' },
  ]
}

// Notification-channel preference mix across non-guest customers.
export async function getCustomerChannelMix(): Promise<BreakdownSlice[]> {
  const rows = await queryMany<{ channel: string | null; count: string }>(`
    SELECT notification_channel AS channel, COUNT(*)::int AS count
    FROM users
    WHERE is_guest = false
    GROUP BY notification_channel
  `)
  const colors: Record<string, string> = { email: '#3b82f6', sms: '#10b981', whatsapp: '#22c55e' }
  const labels: Record<string, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }
  return rows
    .map(r => {
      const key = (r.channel || 'email').toLowerCase()
      return {
        label: labels[key] || (r.channel || 'Email'),
        value: Number(r.count) || 0,
        color: colors[key] || '#94a3b8',
      }
    })
    .sort((a, b) => b.value - a.value)
}
