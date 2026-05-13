import { queryOne, queryMany, queryCount } from './db'
import { DashboardStats } from '@/types'
import { buildSearchClause } from './search'

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const [
      totalProducts,
      totalOrders,
      revenueResult,
      totalCustomers,
      lowStockProducts,
      pendingOrders,
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
        (SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        0
      ) AS variant_stock_total
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
        (SELECT json_agg(pv ORDER BY pv.variant_name)
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants,
      COALESCE(
        (SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        0
      ) AS variant_stock_total,
      (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price
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

export async function getFilteredOrders(filters: {
  status?: string
  payment_status?: string
  source?: string
  search?: string
  page?: number
  limit?: number
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
    const sc = buildSearchClause(filters.search, ['o.order_number', 'o.customer_name'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit

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
      ORDER BY o.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM orders o ${where}`, params),
  ])

  return { orders, total: countResult }
}

export async function getFilteredProducts(filters: {
  category_id?: string
  brand_id?: string
  is_active?: string
  stock?: string
  search?: string
  page?: number
  limit?: number
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
  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['p.name', 'p.sku'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit

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
          (SELECT SUM(pv.stock_quantity) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
          0
        ) AS variant_stock_total,
        (SELECT MIN(COALESCE(pv.sale_price, pv.price)) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true AND (pv.price IS NOT NULL OR pv.sale_price IS NOT NULL)) AS variant_min_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pc ON c.parent_category_id = pc.id
      LEFT JOIN brands b ON p.brand_id = b.id
      ${where}
      ORDER BY p.is_featured DESC, COALESCE(pc.display_order, c.display_order, 9999) ASC, c.display_order ASC, p.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM products p ${where}`, params),
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
    conditions.push(`name ILIKE $${i}`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return queryMany(`SELECT * FROM categories ${where} ORDER BY display_order ASC`, params)
}

export async function getCustomers(filters: {
  search?: string
  status?: string
  page?: number
  limit?: number
}) {
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

  const where = `WHERE ${conditions.join(' AND ')}`
  const limit = filters.limit || 50
  const offset = ((filters.page || 1) - 1) * limit

  const [customers, total] = await Promise.all([
    queryMany(`
      SELECT
        u.id, u.email, u.phone, u.first_name, u.last_name,
        u.is_active, u.is_flagged, u.flag_reason, u.created_at,
        cp.customer_type,
        COALESCE(o.order_count, 0) AS order_count,
        o.last_order_at
      FROM users u
      LEFT JOIN customer_profiles cp ON u.id = cp.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS order_count, MAX(created_at) AS last_order_at
        FROM orders GROUP BY user_id
      ) o ON u.id = o.user_id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM users u ${where}`, params),
  ])

  return { customers, total }
}

export async function getCustomerById(id: string) {
  const customer = await queryOne(`
    SELECT
      u.id, u.email, u.phone, u.first_name, u.last_name,
      u.is_active, u.is_flagged, u.flag_reason, u.created_at,
      cp.customer_type, cp.company_name, cp.gst_number, cp.credit_limit
    FROM users u
    LEFT JOIN customer_profiles cp ON u.id = cp.user_id
    WHERE u.id = $1 AND u.is_guest = false
  `, [id])

  if (!customer) throw new Error('Customer not found')

  const recentOrders = await queryMany(`
    SELECT id, order_number, total_amount, status, payment_status, created_at
    FROM orders
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 5
  `, [id])

  return { ...customer, recent_orders: recentOrders }
}

export async function getRecentOrders(limit: number = 10) {
  return queryMany('SELECT * FROM orders ORDER BY created_at DESC LIMIT $1', [limit])
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
            'products', json_build_object('id', pr.id, 'name', pr.name, 'sku', pr.sku)
          )
        )
        FROM order_items oi
        LEFT JOIN products pr ON oi.product_id = pr.id
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
