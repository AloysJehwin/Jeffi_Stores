import { Pool } from 'pg'
import { queryMany, queryOne } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { embed } from '@/lib/rag'
import { findSimilarProductIds } from '@/lib/rag'

function vec(arr: number[]) { return '[' + arr.join(',') + ']' }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

export interface CustomerToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string; default?: unknown; minimum?: number; maximum?: number; enum?: string[] }>
  required?: string[]
}

export interface CustomerToolContext {
  authenticatedUserId: string
}

export interface CustomerToolDef {
  name: string
  description: string
  inputSchema: CustomerToolInputSchema
  handler: (input: Record<string, unknown>, ctx: CustomerToolContext) => Promise<unknown>
}

export const CUSTOMER_TOOLS: CustomerToolDef[] = [
  {
    name: 'search_products',
    description: 'Semantic search over the active catalog. Use for "find me X" / "I need a Y" queries. Returns ranked candidates with current price + stock.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language description of what the user wants.' },
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
    handler: async ({ query: q, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 10)
      const ids = await findSimilarProductIds(String(q), lim * 2)
      const productIds: string[] = []
      for (const r of ids) {
        if (r.matchedVia === 'products' && r.productId && !productIds.includes(r.productId)) {
          productIds.push(r.productId)
        }
      }
      const variantIds = ids.filter(r => r.matchedVia === 'product_variants' && r.variantId).map(r => r.variantId as string)
      if (variantIds.length) {
        const vp = await queryMany<{ product_id: string }>(
          `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
          [variantIds]
        )
        for (const r of vp) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
      }
      if (productIds.length === 0) return { products: [], note: 'No matches found.' }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description, p.inventory_quantity AS stock
           FROM products p
          WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds.slice(0, lim)]
      )
      const order = new Map(productIds.map((id, i) => [id, i]))
      return { products: rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)) }
    },
  },
  {
    name: 'get_product',
    description: 'Fetch full product details by id or slug. Use after a search to elaborate on one product.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, slug: { type: 'string' } },
    },
    handler: async ({ id, slug }) => {
      if (!id && !slug) throw new Error('Provide id or slug')
      const row = await queryOne(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.short_description, p.description,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.inventory_quantity AS stock
           FROM products p
          WHERE (p.id::text = $1 OR p.slug = $2) AND p.is_active = TRUE
          LIMIT 1`,
        [id || '', slug || '']
      )
      return row || { error: 'Product not found' }
    },
  },
  {
    name: 'find_similar_products',
    description: 'Given a product id, find semantically similar active products. Use for "more like this" suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
      },
      required: ['productId'],
    },
    handler: async ({ productId, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 10)
      const product = await queryOne<{ name: string }>(
        `SELECT name FROM products WHERE id = $1::uuid AND is_active = TRUE`,
        [String(productId)]
      )
      if (!product) return { products: [], note: 'Product not found.' }
      const ids = await findSimilarProductIds(product.name, lim * 2)
      const productIds: string[] = []
      for (const r of ids) {
        if (r.matchedVia === 'products' && r.productId !== productId && !productIds.includes(r.productId)) {
          productIds.push(r.productId)
        }
      }
      if (productIds.length === 0) return { products: [] }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.inventory_quantity AS stock
           FROM products p
          WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds.slice(0, lim)]
      )
      return { products: rows }
    },
  },
  {
    name: 'get_recent_products',
    description: 'Top N most-recently-added active products. Use for "what is new" queries.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 } },
    },
    handler: async ({ limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 10)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description
           FROM products p
          WHERE p.is_active = TRUE
          ORDER BY p.created_at DESC
          LIMIT $1`,
        [lim]
      )
      return { products: rows }
    },
  },
  {
    name: 'get_featured_products',
    description: 'Curated featured products. Use for "what do you recommend" / "popular products".',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 } },
    },
    handler: async ({ limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 10)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description
           FROM products p
          WHERE p.is_active = TRUE AND p.is_featured = TRUE
          ORDER BY p.sales_count DESC NULLS LAST, p.created_at DESC
          LIMIT $1`,
        [lim]
      )
      return { products: rows }
    },
  },
  {
    name: 'get_my_orders',
    description: 'Return the authenticated user\'s OWN orders. Use when they ask "where is my order" / "my recent orders" / "my last purchase". Only returns orders that belong to them — never other customers.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
        status: { type: 'string', description: 'pending|confirmed|processing|shipped|delivered|cancelled' },
      },
    },
    handler: async ({ limit, status }, ctx) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 20)
      const params: unknown[] = [ctx.authenticatedUserId]
      const where = ['o.user_id = $1::uuid']
      if (status) { params.push(status); where.push(`o.status = $${params.length}`) }
      params.push(lim)
      const rows = await queryMany(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status,
                o.total_amount::text, o.created_at, o.delivered_at,
                o.awb_number
           FROM orders o
          WHERE ${where.join(' AND ')}
          ORDER BY o.created_at DESC
          LIMIT $${params.length}`,
        params
      )
      return { orders: rows }
    },
  },
  {
    name: 'get_my_order',
    description: 'Fetch one of the authenticated user\'s OWN orders by order number, including line items. Refuses to return any order that does not belong to them.',
    inputSchema: {
      type: 'object',
      properties: { orderNumber: { type: 'string' } },
      required: ['orderNumber'],
    },
    handler: async ({ orderNumber }, ctx) => {
      const order = await queryOne<{
        id: string; order_number: string; status: string; payment_status: string;
        subtotal: string; total_amount: string; created_at: string; delivered_at: string | null
      }>(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status,
                o.subtotal::text, o.total_amount::text, o.created_at, o.delivered_at
           FROM orders o
          WHERE o.order_number = $1 AND o.user_id = $2::uuid
          LIMIT 1`,
        [String(orderNumber), ctx.authenticatedUserId]
      )
      if (!order) return { error: 'Order not found in your account.' }
      const items = await queryMany(
        `SELECT product_name, product_sku, variant_name, quantity::text, unit_price::text, total_price::text
           FROM order_items WHERE order_id = $1::uuid ORDER BY id`,
        [order.id]
      )
      return { ...order, items }
    },
  },
  {
    name: 'get_my_recommendations',
    description: 'Personalised product recommendations based on the authenticated user\'s OWN purchase history. Use when they ask "recommend something for me" / "based on what I\'ve bought".',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 5, minimum: 1, maximum: 10 } },
    },
    handler: async ({ limit }, ctx) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 10)
      const recentItems = await queryMany<{ product_id: string; product_name: string }>(
        `SELECT DISTINCT oi.product_id::text, oi.product_name
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.user_id = $1::uuid
          ORDER BY oi.product_id::text
          LIMIT 5`,
        [ctx.authenticatedUserId]
      )
      if (recentItems.length === 0) {
        return { products: [], note: 'No purchase history yet — try get_featured_products.' }
      }
      const seedQuery = recentItems.map(i => i.product_name).join(' ')
      const ids = await findSimilarProductIds(seedQuery, lim * 2)
      const ownedIds = new Set(recentItems.map(i => i.product_id))
      const productIds: string[] = []
      for (const r of ids) {
        if (r.matchedVia === 'products' && r.productId && !ownedIds.has(r.productId) && !productIds.includes(r.productId)) {
          productIds.push(r.productId)
        }
      }
      if (productIds.length === 0) return { products: [] }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description
           FROM products p
          WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds.slice(0, lim)]
      )
      return { products: rows }
    },
  },
]

export function getCustomerTool(name: string): CustomerToolDef | null {
  return CUSTOMER_TOOLS.find(t => t.name === name) || null
}
