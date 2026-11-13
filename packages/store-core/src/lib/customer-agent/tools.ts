import { queryMany, queryOne } from '@/lib/shared/db'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { findSimilarProductIds } from '@/lib/shared/rag'
import { buildProductSearchClause } from '@/lib/catalog/search'

function vec(arr: number[]) {
  return '[' + arr.join(',') + ']'
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// Reject if a promise doesn't settle within ms — fast-fails the vector search
// when the RAG store is unreachable so we fall back promptly.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rag-timeout')), ms)
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// Resolve a natural-language query to active product ids. Tries RAG vector
// search first; if it errors (Ollama/RAG store down) or returns nothing, falls
// back to the main-DB keyword + pg_trgm fuzzy search (always available). This
// keeps the assistant able to find products even when the vector store is down.
async function resolveProductIds(query: string, limit: number): Promise<string[]> {
  const productIds: string[] = []
  try {
    const similar = await withTimeout(findSimilarProductIds(query, limit * 3), 6000)
    const variantIds: string[] = []
    for (const r of similar) {
      if (r.matchedVia === 'products' && r.productId && !productIds.includes(r.productId)) productIds.push(r.productId)
      else if (r.matchedVia === 'product_variants' && r.variantId) variantIds.push(r.variantId)
    }
    if (variantIds.length) {
      const vp = await queryMany<{ product_id: string }>(
        `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
        [variantIds]
      )
      for (const r of vp) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
    }
  } catch {
    // vector path unavailable — fall through to keyword search
  }

  if (productIds.length === 0) {
    // Main-DB fallback: full-text + pg_trgm fuzzy over name/sku (tolerates typos).
    const sc = buildProductSearchClause(query, 'p.name', 'p.sku', 'p.search_vector', 1)
    const rows = await queryMany<{ id: string }>(
      `SELECT p.id::text FROM products p
        WHERE p.is_active = TRUE AND ${sc.clause}
        ORDER BY similarity(p.name, $${sc.nextIdx}::text) DESC
        LIMIT $${sc.nextIdx + 1}`,
      [...sc.params, query, limit * 2]
    )
    for (const r of rows) if (!productIds.includes(r.id)) productIds.push(r.id)
  }

  return productIds.slice(0, limit)
}

export interface CustomerToolInputSchema {
  type: 'object'
  properties: Record<
    string,
    { type: string; description?: string; default?: unknown; minimum?: number; maximum?: number; enum?: string[] }
  >
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
    name: 'recommend_for_project',
    description:
      'Find products for a described need, occasion or use-case using semantic vector search. Use when the user describes what they need or what it is for — e.g. "I need a gift for a friend who loves cooking". Returns ranked products with price and stock. Always prefer this over search_products for need-style queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Description of the need or use-case. Max 500 chars.', maximum: 500 },
        limit: { type: 'integer', default: 8, minimum: 1, maximum: 12 },
      },
      required: ['query'],
    },
    handler: async ({ query: q, limit }) => {
      const queryStr = String(q).slice(0, 500)
      const lim = clamp(typeof limit === 'number' ? limit : 8, 1, 12)
      const productIds = await resolveProductIds(queryStr, lim)
      if (productIds.length === 0)
        return { products: [], note: "Sorry, we don't carry products matching that description." }

      const rows = await queryMany<{
        id: string
        name: string
        slug: string
        sku: string
        price: string
        short_description: string | null
        stock_status: string
      }>(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description, p.stock_status
           FROM products p
          WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds]
      )
      const order = new Map(productIds.map((id, i) => [id, i]))
      return { products: rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)) }
    },
  },
  {
    name: 'search_products',
    description:
      'Semantic search over the active catalog. Use for "find me X" / "I need a Y" queries. Returns ranked candidates with current price + stock.',
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
      const productIds = await resolveProductIds(String(q), lim)
      if (productIds.length === 0) return { products: [], note: 'No matches found.' }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description, p.stock_status
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
    description:
      "Fetch full product details by id or slug: description, features, what's in the box, how to use, care, safety, warranty, return window, maker/importer, specifications and FAQs. Use after a search, or to answer a question about one product. Answer only from these fields.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, slug: { type: 'string' } },
    },
    handler: async ({ id, slug }) => {
      if (!id && !slug) throw new Error('Provide id or slug')
      const row = await queryOne<Record<string, unknown>>(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.short_description, p.description,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.stock_status, b.name AS brand, c.name AS category,
                p.ai_features AS features, p.ai_use_cases AS use_cases, p.color, p.material, p.size,
                p.model_number, p.series, p.pack_size, p.net_quantity, p.net_quantity_unit,
                p.in_the_box, p.usage_instructions, p.care_instructions, p.safety_warnings,
                p.warranty_months, p.warranty_type,
                COALESCE(p.return_window_days, b.return_window_days, c.return_window_days) AS return_window_days,
                p.replacement_policy, p.country_of_origin, p.manufacturer_name, p.importer_name,
                p.consumer_care, p.best_before, p.moq, p.lead_time_days, p.specifications,
                (SELECT json_agg(json_build_object('q', f.question, 'a', f.answer) ORDER BY f.sort_order)
                   FROM product_faqs f WHERE f.product_id = p.id AND f.published) AS faqs
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE (p.id::text = $1 OR p.slug = $2) AND p.is_active = TRUE
          LIMIT 1`,
        [id || '', slug || '']
      )
      if (!row) return { error: 'Product not found' }
      // Drop empty fields so the model only sees what the store declared.
      return Object.fromEntries(
        Object.entries(row).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length))
      )
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
      const resolved = await resolveProductIds(product.name, lim + 1)
      const productIds = resolved.filter(id => id !== String(productId)).slice(0, lim)
      if (productIds.length === 0) return { products: [] }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.stock_status
           FROM products p
          WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds]
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
    description:
      'Return the authenticated user\'s OWN orders. Use when they ask "where is my order" / "my recent orders" / "my last purchase". Only returns orders that belong to them — never other customers.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
        status: { type: 'string', description: 'pending|confirmed|processing|shipped|delivered|granted (digital: access granted)|cancelled' },
      },
    },
    handler: async ({ limit, status }, ctx) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 20)
      const params: unknown[] = [ctx.authenticatedUserId]
      const where = ['o.user_id = $1::uuid']
      if (status) {
        params.push(status)
        where.push(`o.status = $${params.length}`)
      }
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
    description:
      "Fetch one of the authenticated user's OWN orders by order number, including line items. Refuses to return any order that does not belong to them.",
    inputSchema: {
      type: 'object',
      properties: { orderNumber: { type: 'string' } },
      required: ['orderNumber'],
    },
    handler: async ({ orderNumber }, ctx) => {
      const order = await queryOne<{
        id: string
        order_number: string
        status: string
        payment_status: string
        subtotal: string
        total_amount: string
        created_at: string
        delivered_at: string | null
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
    description:
      'Personalised product recommendations based on the authenticated user\'s OWN purchase history. Use when they ask "recommend something for me" / "based on what I\'ve bought".',
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
        if (
          r.matchedVia === 'products' &&
          r.productId &&
          !ownedIds.has(r.productId) &&
          !productIds.includes(r.productId)
        ) {
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
