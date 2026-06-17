import { queryOne, queryMany, queryCount } from './db'
import { DashboardStats } from '@/types'
import { buildSearchClause, buildProductSearchClause, buildProductSearchRank, buildVectorSearchClause } from './search'

export const VARIANT_STOCK_TOTAL_SQL = `
  COALESCE((SELECT SUM(
    CASE
      WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
      THEN COALESCE((SELECT SUM(sv.stock_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
      ELSE pv.stock_quantity
    END
  ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true), 0)
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
      queryCount('SELECT COUNT(*) FROM products WHERE stock_quantity <= low_stock_threshold'),
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
        (SELECT SUM(
          CASE
            WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            THEN COALESCE((SELECT SUM(sv.stock_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
            ELSE pv.stock_quantity
          END
        ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
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
            'stock_quantity', pv.stock_quantity, 'inventory_quantity', pv.inventory_quantity,
            'mpn', pv.mpn, 'gtin', pv.gtin, 'pricing_type', pv.pricing_type,
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
                  'stock_quantity', sv.stock_quantity, 'inventory_quantity', sv.inventory_quantity,
                  'is_active', sv.is_active
                )
                ORDER BY sv.sub_variant_name
              )
               FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
              '[]'::json
            ),
            'sub_variant_min_price', (SELECT MIN(sv.price) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true AND sv.price IS NOT NULL),
            'sub_variant_stock_total', COALESCE((SELECT SUM(sv.stock_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0),
            'sub_variant_inventory_total', COALESCE((SELECT SUM(sv.inventory_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
          )
          ORDER BY pv.variant_name
        )
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants,
      COALESCE(
        (SELECT SUM(
          CASE
            WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
            THEN COALESCE((SELECT SUM(sv.stock_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
            ELSE pv.stock_quantity
          END
        ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
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
  return queryMany('SELECT * FROM categories ORDER BY display_order ASC')
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
  price: 'p.price',
  stock: 'p.stock_quantity',
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
  page?: number
  limit?: number
  sort?: string
  dir?: string
}) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

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
  }
  if (filters.stock === 'low') {
    conditions.push(`(
      (p.has_variants = false AND p.stock_quantity <= p.low_stock_threshold AND p.stock_quantity > 0)
      OR (p.has_variants = true AND COALESCE((SELECT SUM(pv2.stock_quantity) FROM product_variants pv2 WHERE pv2.product_id = p.id AND pv2.is_active = true), 0) > 0
        AND COALESCE((SELECT SUM(pv2.stock_quantity) FROM product_variants pv2 WHERE pv2.product_id = p.id AND pv2.is_active = true), 0) <= p.low_stock_threshold)
    )`)
  } else if (filters.stock === 'out') {
    conditions.push(`(
      (p.has_variants = false AND p.stock_quantity = 0)
      OR (p.has_variants = true AND COALESCE((SELECT SUM(pv2.stock_quantity) FROM product_variants pv2 WHERE pv2.product_id = p.id AND pv2.is_active = true), 0) = 0)
    )`)
  }
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
          (SELECT SUM(
            CASE
              WHEN EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true)
              THEN COALESCE((SELECT SUM(sv.stock_quantity) FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true), 0)
              ELSE pv.stock_quantity
            END
          ) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
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
        ) AS combined_mrps) AS variant_min_mrp
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

export async function getFilteredCategories(filters: {
  is_active?: string
  type?: string
  search?: string
}) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

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
      u.user_type,
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
           a.username AS admin_username, u.first_name AS admin_first_name, u.last_name AS admin_last_name
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
            'products', json_build_object(
              'id', pr.id, 'name', pr.name, 'sku', pr.sku,
              'inventory_quantity', pr.inventory_quantity
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
      (SELECT row_to_json(sa) FROM addresses sa WHERE sa.id = o.shipping_address_id) AS shipping_address,
      (SELECT row_to_json(ba) FROM addresses ba WHERE ba.id = o.billing_address_id) AS billing_address,
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
    SELECT rr.*, o2.order_number AS replacement_order_number
    FROM return_requests rr
    LEFT JOIN orders o2 ON o2.id = rr.replacement_order_id
    WHERE rr.order_id = $1
    ORDER BY rr.created_at DESC
    LIMIT 1
  `, [orderId])
  return returnRequest || null
}
