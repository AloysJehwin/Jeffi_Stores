import { query, queryMany, queryOne } from '@/lib/db'
import { embed } from '@/lib/rag'

function vec(arr: number[]) { return '[' + arr.join(',') + ']' }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string; default?: unknown; minimum?: number; maximum?: number; enum?: string[] }>
  required?: string[]
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: ToolInputSchema
  mutating: boolean
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

export const TOOLS: ToolDef[] = [
  {
    name: 'search_products',
    description: 'Semantic product search over the catalog. Use for "find me X" / "products like Y" queries. Returns ranked candidates with current price + stock.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language description of what you want.' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    mutating: false,
    handler: async ({ query: q, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 10, 1, 50)
      const v = await embed(String(q))
      const ids = await queryMany<{ source_table: string; source_id: string; sim: number }>(
        `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table IN ('products', 'product_variants')
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(v), lim * 2]
      ).catch(() => [])

      const productIds: string[] = []
      for (const r of ids) {
        if (r.source_table === 'products' && !productIds.includes(r.source_id)) productIds.push(r.source_id)
      }
      const variantSrcIds = ids.filter(r => r.source_table === 'product_variants').map(r => r.source_id)
      if (variantSrcIds.length) {
        const vp = await queryMany<{ product_id: string }>(
          `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
          [variantSrcIds]
        )
        for (const r of vp) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
      }
      if (productIds.length === 0) return { products: [], note: 'No matches found.' }
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.base_price::text AS price, p.inventory_quantity AS stock,
                b.name AS brand, c.name AS category
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds.slice(0, lim)]
      )
      const order = new Map(productIds.map((id, i) => [id, i]))
      return { products: rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)) }
    },
  },
  {
    name: 'get_product',
    description: 'Fetch full product details by id or slug.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, slug: { type: 'string' } },
    },
    mutating: false,
    handler: async ({ id, slug }) => {
      if (!id && !slug) throw new Error('Provide id or slug')
      const row = await queryOne(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.short_description, p.description,
                p.base_price::text AS price, p.mrp::text AS mrp, p.gst_percentage,
                p.inventory_quantity AS stock, p.is_active, p.hsn_code,
                b.name AS brand, c.name AS category
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1::uuid OR p.slug = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', slug || '']
      )
      return row || { error: 'Product not found' }
    },
  },
  {
    name: 'get_product_variants',
    description: 'List variants for a product.',
    inputSchema: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
    },
    mutating: false,
    handler: async ({ productId }) => {
      const rows = await queryMany(
        `SELECT id::text, variant_name, sku, price::text, mrp::text, stock_quantity AS stock, is_active
         FROM product_variants WHERE product_id = $1::uuid ORDER BY variant_name`,
        [productId]
      )
      return { variants: rows }
    },
  },
  {
    name: 'find_similar_products',
    description: 'Given a product id, find semantically similar products from the catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['productId'],
    },
    mutating: false,
    handler: async ({ productId, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 10, 1, 50)
      const src = await queryOne<{ embedding: string }>(
        `SELECT embedding::text FROM embeddings WHERE source_table = 'products' AND source_id = $1 LIMIT 1`,
        [String(productId)]
      ).catch(() => null)
      if (!src) return { products: [], note: 'Product has no embedding yet.' }
      const rows = await queryMany<{ source_id: string; sim: number }>(
        `SELECT source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table = 'products' AND source_id != $2
         ORDER BY embedding <=> $1::vector LIMIT $3`,
        [src.embedding, productId, lim]
      )
      const ids = rows.map(x => x.source_id)
      if (ids.length === 0) return { products: [] }
      const out = await queryMany(
        `SELECT id::text, name, slug, sku, base_price::text AS price, inventory_quantity AS stock
         FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
        [ids]
      )
      return { products: out }
    },
  },
  {
    name: 'search_customers',
    description: 'Semantic search over customers by name / email / phone fragments.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    mutating: false,
    handler: async ({ query: q, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 10, 1, 50)
      const v = await embed(String(q))
      const rows = await queryMany<{ source_id: string }>(
        `SELECT source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table = 'users'
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(v), lim]
      ).catch(() => [])
      const ids = rows.map(x => x.source_id)
      if (ids.length === 0) return { customers: [] }
      const out = await queryMany(
        `SELECT u.id::text, u.email, u.first_name, u.last_name, u.phone, u.created_at,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::int AS paid_orders,
                COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::text AS lifetime_value
         FROM users u WHERE u.id = ANY($1::uuid[])`,
        [ids]
      )
      return { customers: out }
    },
  },
  {
    name: 'get_customer',
    description: 'Fetch a customer by id or email, including order count and lifetime value.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, email: { type: 'string' } },
    },
    mutating: false,
    handler: async ({ id, email }) => {
      if (!id && !email) throw new Error('Provide id or email')
      const row = await queryOne(
        `SELECT u.id::text, u.email, u.first_name, u.last_name, u.phone, u.is_guest, u.marketing_opt_out, u.created_at,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id), 0)::int AS total_orders,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::int AS paid_orders,
                COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::text AS lifetime_value,
                (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
         FROM users u WHERE u.id = $1::uuid OR u.email = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', email || '']
      )
      return row || { error: 'Customer not found' }
    },
  },
  {
    name: 'get_recent_orders',
    description: 'Recent orders, optionally filtered by user, status, or days back.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        status: { type: 'string', description: 'pending|confirmed|processing|shipped|delivered|cancelled' },
        days: { type: 'integer', default: 7, minimum: 1, maximum: 365 },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
    },
    mutating: false,
    handler: async ({ userId, status, days, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 20, 1, 100)
      const d = clamp(typeof days === 'number' ? days : 7, 1, 365)
      const params: unknown[] = [d]
      const where = [`o.created_at > NOW() - ($1 || ' days')::interval`]
      if (userId) { params.push(userId); where.push(`o.user_id = $${params.length}::uuid`) }
      if (status) { params.push(status); where.push(`o.status = $${params.length}`) }
      params.push(lim)
      const rows = await queryMany(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status, o.total_amount::text, o.created_at,
                u.email AS customer_email, u.first_name || ' ' || u.last_name AS customer_name
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY o.created_at DESC LIMIT $${params.length}`,
        params
      )
      return { orders: rows, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_order',
    description: 'Full order detail including line items.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, orderNumber: { type: 'string' } },
    },
    mutating: false,
    handler: async ({ id, orderNumber }) => {
      if (!id && !orderNumber) throw new Error('Provide id or orderNumber')
      const order = await queryOne<any>(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status, o.subtotal::text, o.discount_amount::text,
                o.tax_amount::text, o.shipping_amount::text, o.total_amount::text, o.notes, o.created_at, o.delivered_at,
                o.shipping_address_snapshot,
                u.email AS customer_email, u.first_name || ' ' || u.last_name AS customer_name, u.phone
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id = $1::uuid OR o.order_number = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', orderNumber || '']
      )
      if (!order) return { error: 'Order not found' }
      const items = await queryMany(
        `SELECT product_name, product_sku, variant_name, quantity::text, unit_price::text, total_price::text
         FROM order_items WHERE order_id = $1::uuid ORDER BY id`,
        [order.id]
      )
      return { ...order, items }
    },
  },
  {
    name: 'get_low_stock_products',
    description: 'Products with inventory at or below a threshold. Useful for restock decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'integer', default: 10, minimum: 0, maximum: 1000 },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
      },
    },
    mutating: false,
    handler: async ({ threshold, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 50, 1, 200)
      const t = clamp(typeof threshold === 'number' ? threshold : 10, 0, 1000)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.sku, p.inventory_quantity AS stock, p.base_price::text AS price, b.name AS brand
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.is_active = TRUE AND p.inventory_quantity <= $1
         ORDER BY p.inventory_quantity ASC, p.name ASC LIMIT $2`,
        [t, lim]
      )
      return { products: rows, threshold: t, count: rows.length, truncated: rows.length === lim }
    },
  },
  {
    name: 'get_campaign_stats',
    description: 'Performance for behavioral campaigns. Sent / opened / clicked / converted, optionally for a single campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Campaign kind slug. Omit for all.' },
        days: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      },
    },
    mutating: false,
    handler: async ({ kind, days }) => {
      const d = clamp(typeof days === 'number' ? days : 30, 1, 365)
      const params: unknown[] = [d]
      let where = `WHERE sent_at > NOW() - ($1 || ' days')::interval`
      if (kind) { params.push(kind); where += ` AND campaign_kind = $${params.length}` }
      const rows = await queryMany(
        `SELECT campaign_kind,
                COUNT(*)::int AS sent,
                COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
                COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
                COUNT(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted
         FROM email_campaigns_sent ${where} GROUP BY campaign_kind ORDER BY sent DESC`,
        params
      )
      return { window_days: d, campaigns: rows }
    },
  },
  {
    name: 'send_test_email',
    description: 'Propose sending a test email of a campaign template to a specific email address. The admin must approve before it sends. Use this when a user asks to test how a campaign looks.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignKind: { type: 'string', description: 'The campaign kind slug, e.g. abandoned_cart.' },
        toEmail: { type: 'string', description: 'Recipient email address for the test send.' },
      },
      required: ['campaignKind', 'toEmail'],
    },
    mutating: true,
    handler: async ({ campaignKind, toEmail }) => {
      if (!campaignKind || !toEmail || !String(toEmail).includes('@')) throw new Error('Invalid args')
      const c = await queryOne(`SELECT kind, name FROM campaigns WHERE kind = $1`, [campaignKind])
      if (!c) throw new Error(`Unknown campaign: ${campaignKind}`)
      return {
        proposed: true,
        kind: 'send_test_email',
        payload: { campaignKind, toEmail, campaignName: c.name },
        confirmation: `Send a test of "${c.name}" (${campaignKind}) to ${toEmail}?`,
      }
    },
  },
  {
    name: 'toggle_campaign_enabled',
    description: 'Propose enabling or disabling a campaign. Admin must approve.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignKind: { type: 'string' },
        enabled: { type: 'string', description: 'true or false' },
      },
      required: ['campaignKind', 'enabled'],
    },
    mutating: true,
    handler: async ({ campaignKind, enabled }) => {
      const c = await queryOne<{ kind: string; name: string; enabled: boolean }>(
        `SELECT kind, name, enabled FROM campaigns WHERE kind = $1`, [campaignKind]
      )
      if (!c) throw new Error(`Unknown campaign: ${campaignKind}`)
      const target = String(enabled).toLowerCase() === 'true'
      if (c.enabled === target) {
        return { proposed: false, info: `Campaign "${c.name}" is already ${target ? 'enabled' : 'disabled'}.` }
      }
      return {
        proposed: true,
        kind: 'toggle_campaign_enabled',
        payload: { campaignKind, enabled: target, campaignName: c.name },
        confirmation: `${target ? 'Enable' : 'Disable'} campaign "${c.name}"?`,
      }
    },
  },
  {
    name: 'mark_order_shipped',
    description: 'Propose marking an order as shipped. Optionally include AWB number. Admin must approve.',
    inputSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'string' },
        awbNumber: { type: 'string', description: 'Optional Delhivery AWB' },
      },
      required: ['orderNumber'],
    },
    mutating: true,
    handler: async ({ orderNumber, awbNumber }) => {
      const o = await queryOne<{ id: string; order_number: string; status: string }>(
        `SELECT id::text, order_number, status FROM orders WHERE order_number = $1 LIMIT 1`,
        [orderNumber]
      )
      if (!o) throw new Error(`Unknown order: ${orderNumber}`)
      if (o.status === 'shipped' || o.status === 'delivered') {
        return { proposed: false, info: `Order ${o.order_number} is already ${o.status}.` }
      }
      return {
        proposed: true,
        kind: 'mark_order_shipped',
        payload: { orderId: o.id, orderNumber: o.order_number, awbNumber: awbNumber || null },
        confirmation: `Mark order ${o.order_number} as shipped${awbNumber ? ` with AWB ${awbNumber}` : ''}?`,
      }
    },
  },
]

export function getTool(name: string): ToolDef | null {
  return TOOLS.find(t => t.name === name) || null
}
