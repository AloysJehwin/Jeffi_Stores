import { Pool } from 'pg'
import { query, queryMany, queryOne } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { embed } from '@/lib/rag'

function vec(arr: number[]) { return '[' + arr.join(',') + ']' }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

const FORBIDDEN_TABLES = [
  'admins',
  'admin_agent_messages',
  'admin_agent_actions',
  'admin_sessions',
  'payment_methods',
  'razorpay_webhooks',
  'webhook_events',
  'schema_migrations',
]
const FORBIDDEN_COLUMNS = ['password_hash', 'password', 'totp_secret', 'reset_token', 'razorpay_signature']
const SQL_BLOCKLIST_RE = new RegExp(
  `\\b(${[...FORBIDDEN_TABLES, ...FORBIDDEN_COLUMNS].join('|')})\\b`,
  'i'
)
const SQL_DML_RE = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum|analyze|reindex|comment|cluster|lock|listen|notify|set\s+role|reset\s+role)\b/i

let _readonlyPool: Pool | null = null
function getReadonlyPool(): Pool {
  if (!_readonlyPool) {
    const conn = process.env.DATABASE_URL
    if (!conn) throw new Error('DATABASE_URL not configured')
    _readonlyPool = new Pool({
      connectionString: conn,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: /amazonaws|sslmode=require/.test(conn) ? { rejectUnauthorized: false } : undefined,
    })
    _readonlyPool.on('error', () => {})
  }
  return _readonlyPool
}

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
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.inventory_quantity AS stock,
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
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.mrp::text AS mrp, p.gst_percentage,
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
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.inventory_quantity AS stock
         FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
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
        `SELECT p.id::text, p.name, p.sku, p.inventory_quantity AS stock,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                b.name AS brand
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
  {
    name: 'list_admin_tools',
    description: 'Introspection. Returns the names, descriptions, and mutating-flag of every tool the admin agent itself has access to. Use when the user asks "what can you do?" or wants a capabilities tour.',
    inputSchema: { type: 'object', properties: {} },
    mutating: false,
    handler: async () => {
      return {
        tools: TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          mutating: t.mutating,
          args: Object.keys(t.inputSchema.properties || {}),
        })),
        count: TOOLS.length,
      }
    },
  },
  {
    name: 'run_sql_readonly',
    description: 'Run a single read-only SELECT against the live database for ad-hoc questions the other tools do not cover. Auto-wrapped in a READ ONLY transaction with a 5-second statement timeout; writes, DDL, and access to admins/payment_methods/password columns are blocked. Returns up to 100 rows. Prefer the dedicated tools when one fits.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single SELECT statement. No semicolons except at the end. No CTE writes.' },
      },
      required: ['sql'],
    },
    mutating: false,
    handler: async ({ sql }) => {
      const raw = String(sql || '').trim().replace(/;\s*$/, '')
      if (!raw) throw new Error('sql is required')
      if (raw.length > 4000) throw new Error('sql too long (max 4000 chars)')
      if (raw.includes(';')) throw new Error('semicolons not allowed inside the statement')
      if (!/^(with\b|select\b)/i.test(raw)) throw new Error('only SELECT or WITH...SELECT is permitted')
      if (SQL_DML_RE.test(raw)) throw new Error('write/DDL keywords are forbidden')
      if (SQL_BLOCKLIST_RE.test(raw)) throw new Error('query references a forbidden table or column')

      const guarded = `${raw} LIMIT 100`
      const pool = getReadonlyPool()
      const client = await pool.connect()
      try {
        await client.query('BEGIN READ ONLY')
        await client.query("SET LOCAL statement_timeout = '5s'")
        const result = await client.query(guarded)
        await client.query('ROLLBACK')
        return {
          rowCount: result.rowCount ?? result.rows.length,
          fields: result.fields?.map(f => f.name) || [],
          rows: result.rows.slice(0, 100),
          truncated: (result.rowCount ?? result.rows.length) >= 100,
        }
      } catch (err: any) {
        try { await client.query('ROLLBACK') } catch {}
        throw new Error(`SQL error: ${err?.message || err}`)
      } finally {
        client.release()
      }
    },
  },
  {
    name: 'find_customer_orders',
    description: 'Look up a customer by name or email and return their orders, ordered by most recent first. Use when the user references "Aloys Jehwin\'s recent order" without an order number — call this first, then ask the admin to pick an order via the disambiguation flow.',
    inputSchema: {
      type: 'object',
      properties: {
        customerQuery: { type: 'string', description: 'Customer name or email fragment.' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['customerQuery'],
    },
    mutating: false,
    handler: async ({ customerQuery, limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 10, 1, 50)
      const q = String(customerQuery || '').trim()
      if (!q) throw new Error('customerQuery is required')
      const customers = await queryMany<{
        id: string; email: string; first_name: string | null; last_name: string | null
      }>(
        `SELECT id::text, email, first_name, last_name
           FROM users
          WHERE email ILIKE $1
             OR first_name ILIKE $1
             OR last_name ILIKE $1
             OR (first_name || ' ' || last_name) ILIKE $1
          ORDER BY (CASE WHEN email ILIKE $1 THEN 0 ELSE 1 END), created_at DESC
          LIMIT 5`,
        [`%${q}%`]
      )
      if (customers.length === 0) {
        return { customers: [], orders: [], note: 'No matching customer found.' }
      }
      if (customers.length > 1) {
        return {
          needs_choice: true,
          choice_kind: 'customer',
          options: customers.map(c => ({
            id: c.id,
            label: `${(c.first_name || '') + ' ' + (c.last_name || '')}`.trim() || c.email,
            sublabel: c.email,
          })),
          note: 'Multiple customers match — ask the admin to pick one.',
        }
      }
      const c = customers[0]
      const orders = await queryMany<{
        id: string; order_number: string; status: string; payment_status: string;
        total_amount: string; created_at: string
      }>(
        `SELECT id::text, order_number, status, payment_status, total_amount::text, created_at
           FROM orders
          WHERE user_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2`,
        [c.id, lim]
      )
      return {
        customer: { id: c.id, email: c.email, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() },
        orders,
      }
    },
  },
  {
    name: 'propose_order_delay_email',
    description: 'Propose sending a delivery-delay notification email to the customer of a specific order. The admin must approve before it sends. Use when the user says things like "tell customer X their order #Y will be delayed by N days because Z". If the order number is missing, call find_customer_orders first and ask the admin to pick one.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order UUID.' },
        orderNumber: { type: 'string', description: 'Alternative to orderId. Either is fine.' },
        delayDays: { type: 'integer', description: 'Number of days the order will be delayed (1-90).', minimum: 1, maximum: 90 },
        reason: { type: 'string', description: 'Customer-facing reason. Keep it brief and honest. e.g. "courier strike", "stock shortage from supplier", "weather disruption".' },
      },
      required: ['delayDays', 'reason'],
    },
    mutating: true,
    handler: async ({ orderId, orderNumber, delayDays, reason }) => {
      const days = clamp(typeof delayDays === 'number' ? delayDays : 0, 1, 90)
      const reasonText = String(reason || '').trim()
      if (!reasonText) throw new Error('reason is required')
      if (reasonText.length > 280) throw new Error('reason too long (max 280 chars)')
      if (!orderId && !orderNumber) throw new Error('Provide orderId or orderNumber')

      const order = await queryOne<{
        id: string; order_number: string; status: string; user_id: string;
        customer_email: string; customer_name: string;
      }>(
        `SELECT o.id::text, o.order_number, o.status, o.user_id::text,
                u.email AS customer_email,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS customer_name
           FROM orders o
           LEFT JOIN users u ON u.id = o.user_id
          WHERE o.id = $1::uuid OR o.order_number = $2
          LIMIT 1`,
        [orderId || '00000000-0000-0000-0000-000000000000', orderNumber || '']
      )
      if (!order) throw new Error('Order not found')
      if (!order.customer_email) throw new Error('Order has no customer email on file')
      if (['delivered', 'cancelled'].includes(order.status)) {
        return { proposed: false, info: `Order ${order.order_number} is already ${order.status}; delay email not appropriate.` }
      }
      return {
        proposed: true,
        kind: 'send_order_delay_email',
        payload: {
          orderId: order.id,
          orderNumber: order.order_number,
          customerEmail: order.customer_email,
          customerName: order.customer_name,
          delayDays: days,
          reason: reasonText,
        },
        confirmation: `Email ${order.customer_email} that order ${order.order_number} will be delayed by ${days} day${days === 1 ? '' : 's'}: "${reasonText}"?`,
      }
    },
  },
  {
    name: 'estimate_email_audience',
    description: 'Count how many customers would receive a marketing email under a given audience filter, BEFORE proposing a blast. Always call this first so the admin sees the blast radius. Filters: "all_opted_in", "recent_buyers" (placed an order in the last 90 days), or "test_only" (single email).',
    inputSchema: {
      type: 'object',
      properties: {
        audience: { type: 'string', description: 'all_opted_in | recent_buyers | test_only' },
        testEmail: { type: 'string', description: 'Required when audience=test_only.' },
      },
      required: ['audience'],
    },
    mutating: false,
    handler: async ({ audience, testEmail }) => {
      const a = String(audience || '').toLowerCase()
      if (a === 'test_only') {
        const email = String(testEmail || '').trim()
        if (!email.includes('@')) throw new Error('testEmail must be a valid email when audience=test_only')
        return { audience: 'test_only', count: 1, sample: [email] }
      }
      if (a === 'all_opted_in') {
        const r = await queryOne<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM users
            WHERE email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
        )
        return { audience: 'all_opted_in', count: r?.n || 0 }
      }
      if (a === 'recent_buyers') {
        const r = await queryOne<{ n: number }>(
          `SELECT COUNT(DISTINCT u.id)::int AS n
             FROM users u
             JOIN orders o ON o.user_id = u.id
            WHERE u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
              AND o.created_at > NOW() - INTERVAL '90 days'`
        )
        return { audience: 'recent_buyers', count: r?.n || 0 }
      }
      throw new Error('audience must be one of: all_opted_in, recent_buyers, test_only')
    },
  },
  {
    name: 'propose_product_announcement_email',
    description: 'Propose a marketing-style email featuring a list of products to a chosen audience. The admin must approve before it sends. ALWAYS call estimate_email_audience first so the user sees the blast radius. Provide a short subject + intro line; the email template will render product cards. For audience=test_only, also pass testEmail.',
    inputSchema: {
      type: 'object',
      properties: {
        productIds: { type: 'array', description: 'UUIDs of products to feature (1-10).' },
        audience: { type: 'string', description: 'all_opted_in | recent_buyers | test_only' },
        testEmail: { type: 'string', description: 'Required when audience=test_only.' },
        subject: { type: 'string', description: 'Email subject line. Keep under 80 chars.' },
        intro: { type: 'string', description: 'One short sentence shown above the product cards. Keep under 240 chars.' },
      },
      required: ['productIds', 'audience', 'subject', 'intro'],
    },
    mutating: true,
    handler: async ({ productIds, audience, testEmail, subject, intro }) => {
      const ids = Array.isArray(productIds) ? productIds.map(String).filter(Boolean) : []
      if (ids.length < 1 || ids.length > 10) throw new Error('Provide 1-10 productIds')
      const audKey = String(audience || '').toLowerCase()
      if (!['all_opted_in', 'recent_buyers', 'test_only'].includes(audKey)) {
        throw new Error('audience must be all_opted_in, recent_buyers, or test_only')
      }
      const subj = String(subject || '').trim()
      const intr = String(intro || '').trim()
      if (!subj || subj.length > 80) throw new Error('subject required, max 80 chars')
      if (!intr || intr.length > 240) throw new Error('intro required, max 240 chars')
      const products = await queryMany<{
        id: string; name: string; slug: string; price: string; short_description: string | null
      }>(
        `SELECT p.id::text, p.name, p.slug,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description
           FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [ids]
      )
      if (products.length !== ids.length) {
        return { proposed: false, info: `Only ${products.length} of ${ids.length} ids resolved to active products. Re-check the ids.` }
      }
      let audCount = 0
      let testTo: string | null = null
      if (audKey === 'test_only') {
        const e = String(testEmail || '').trim()
        if (!e.includes('@')) throw new Error('testEmail required when audience=test_only')
        testTo = e
        audCount = 1
      } else if (audKey === 'all_opted_in') {
        const r = await queryOne<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM users
            WHERE email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
        )
        audCount = r?.n || 0
      } else {
        const r = await queryOne<{ n: number }>(
          `SELECT COUNT(DISTINCT u.id)::int AS n
             FROM users u JOIN orders o ON o.user_id = u.id
            WHERE u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
              AND o.created_at > NOW() - INTERVAL '90 days'`
        )
        audCount = r?.n || 0
      }
      return {
        proposed: true,
        kind: 'send_product_announcement_email',
        payload: {
          productIds: products.map(p => p.id),
          productNames: products.map(p => p.name),
          audience: audKey,
          testEmail: testTo,
          subject: subj,
          intro: intr,
          audienceCount: audCount,
        },
        confirmation: `Send "${subj}" featuring ${products.length} product${products.length === 1 ? '' : 's'} to ${audCount} recipient${audCount === 1 ? '' : 's'} (${audKey === 'test_only' ? testTo : audKey})?`,
      }
    },
  },
  {
    name: 'describe_schema',
    description: 'Read database schema. Returns the column list for a given table, or the full table list if no table is named. Use BEFORE writing run_sql_readonly queries against unfamiliar tables. Sensitive tables (admins, payment_methods, agent internals) are filtered out.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name. Omit to list all tables.' },
      },
    },
    mutating: false,
    handler: async ({ table }) => {
      const t = String(table || '').trim()
      if (!t) {
        const rows = await queryMany<{ table_name: string; n_cols: number }>(
          `SELECT t.table_name::text,
                  (SELECT COUNT(*)::int FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS n_cols
             FROM information_schema.tables t
            WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
              AND t.table_name NOT IN (${FORBIDDEN_TABLES.map((_, i) => `$${i + 1}`).join(',')})
            ORDER BY t.table_name`,
          FORBIDDEN_TABLES
        )
        return { tables: rows, count: rows.length }
      }
      if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(t)) throw new Error('Invalid table name')
      if (FORBIDDEN_TABLES.includes(t.toLowerCase())) {
        return { error: `Table "${t}" is not accessible.` }
      }
      const cols = await queryMany<{
        column_name: string; data_type: string; is_nullable: string; column_default: string | null
      }>(
        `SELECT column_name::text, data_type::text, is_nullable::text, column_default::text
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [t]
      )
      const filtered = cols.filter(c => !FORBIDDEN_COLUMNS.includes(c.column_name.toLowerCase()))
      return { table: t, columns: filtered, hidden: cols.length - filtered.length }
    },
  },
  {
    name: 'list_repo_files',
    description: 'List source files under a project-relative directory so you can find canonical helpers (queries, email templates, API contracts). Use this to discover what files exist BEFORE read_repo_file. Common useful directories: src/lib, src/lib/email-templates, src/app/api/admin, database/schema. Forbidden: .env files, lib/jwt.ts, lib/auth*, lib/db.ts, anything matching password|secret|token|api_key.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Project-relative directory, e.g. "src/lib" or "src/app/api/admin"' },
        pattern: { type: 'string', description: 'Optional substring filter on file names' },
      },
      required: ['dir'],
    },
    mutating: false,
    handler: async ({ dir, pattern }) => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const requested = String(dir || '').trim().replace(/^\/+/, '')
      if (!requested || requested.includes('..') || requested.startsWith('/')) {
        throw new Error('Invalid dir — must be project-relative')
      }
      const FORBIDDEN = /(^|\/)(\.env[^/]*|node_modules|\.git|\.next|lib\/jwt\.ts|lib\/auth[^/]*|lib\/db\.ts)(\/|$)|password|secret|token|api_key|access_key/i
      if (FORBIDDEN.test(requested)) throw new Error('Path is forbidden')
      const root = path.resolve(process.cwd(), requested)
      const projectRoot = path.resolve(process.cwd())
      if (!root.startsWith(projectRoot + path.sep) && root !== projectRoot) {
        throw new Error('Path escapes project root')
      }
      const filter = String(pattern || '').toLowerCase()
      const out: { path: string; size: number }[] = []
      async function walk(d: string, depth: number) {
        if (depth > 4 || out.length > 100) return
        let entries
        try { entries = await fs.readdir(d, { withFileTypes: true }) } catch { return }
        for (const ent of entries) {
          if (out.length > 100) return
          const full = path.join(d, ent.name)
          const rel = path.relative(projectRoot, full).replace(/\\/g, '/')
          if (FORBIDDEN.test(rel)) continue
          if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === '.next' || ent.name === '.git') continue
            await walk(full, depth + 1)
          } else if (ent.isFile()) {
            if (filter && !ent.name.toLowerCase().includes(filter)) continue
            try {
              const stat = await fs.stat(full)
              out.push({ path: rel, size: stat.size })
            } catch {}
          }
        }
      }
      await walk(root, 0)
      out.sort((a, b) => a.path.localeCompare(b.path))
      return { files: out, count: out.length, truncated: out.length >= 100 }
    },
  },
  {
    name: 'read_repo_file',
    description: 'Read a project source file to learn how something is implemented (canonical SQL fragments, email helpers, API contracts, business rules). Use this when you need to understand domain quirks before generating SQL or rendering output. Returns up to 8KB of content. Forbidden: .env*, lib/jwt.ts, lib/auth*, lib/db.ts, anything matching password|secret|token|api_key.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative file path, e.g. "src/lib/queries.ts"' },
        offset: { type: 'integer', description: 'Byte offset to start reading from (for files larger than 8KB)' },
      },
      required: ['path'],
    },
    mutating: false,
    handler: async ({ path: filePath, offset }) => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const requested = String(filePath || '').trim().replace(/^\/+/, '')
      if (!requested || requested.includes('..') || requested.startsWith('/')) {
        throw new Error('Invalid path — must be project-relative')
      }
      const FORBIDDEN = /(^|\/)(\.env[^/]*|node_modules|\.git|\.next|lib\/jwt\.ts|lib\/auth[^/]*|lib\/db\.ts)(\/|$)|password|secret|token|api_key|access_key/i
      if (FORBIDDEN.test(requested)) throw new Error('File is forbidden')
      const projectRoot = path.resolve(process.cwd())
      const full = path.resolve(projectRoot, requested)
      if (!full.startsWith(projectRoot + path.sep)) throw new Error('Path escapes project root')
      const start = Math.max(0, typeof offset === 'number' ? offset : 0)
      const MAX = 8 * 1024
      try {
        const handle = await fs.open(full, 'r')
        try {
          const stat = await handle.stat()
          const buf = Buffer.alloc(Math.min(MAX, Math.max(0, stat.size - start)))
          const { bytesRead } = await handle.read(buf, 0, buf.length, start)
          const text = buf.subarray(0, bytesRead).toString('utf8')
          return {
            path: requested,
            size: stat.size,
            offset: start,
            bytesRead,
            content: text,
            truncated: start + bytesRead < stat.size,
          }
        } finally { await handle.close() }
      } catch (err: any) {
        if (err?.code === 'ENOENT') throw new Error(`File not found: ${requested}`)
        throw err
      }
    },
  },
  {
    name: 'list_admin_api_routes',
    description: 'List the real /api/admin/* routes that exist in the codebase. Returns paths and the HTTP methods exported by each route file. Use BEFORE call_admin_api so you do not guess endpoints. Filter results with the optional pathContains substring.',
    inputSchema: {
      type: 'object',
      properties: {
        pathContains: { type: 'string', description: 'Substring filter (e.g. "brands", "orders/", "campaigns").' },
      },
    },
    mutating: false,
    handler: async ({ pathContains }) => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const root = path.resolve(process.cwd(), 'src/app/api/admin')
      const filter = String(pathContains || '').toLowerCase()
      const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/

      async function walk(dir: string, acc: string[]) {
        let entries
        try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
        for (const ent of entries) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) await walk(full, acc)
          else if (ent.name === 'route.ts' || ent.name === 'route.tsx') acc.push(full)
        }
      }

      const files: string[] = []
      await walk(root, files)

      const results: { path: string; methods: string[] }[] = []
      for (const f of files) {
        const rel = '/api/admin' + f.slice(root.length).replace(/\/route\.tsx?$/, '')
        if (FORBIDDEN_PATH_RE.test(rel)) continue
        if (filter && !rel.toLowerCase().includes(filter)) continue
        let src: string
        try { src = await fs.readFile(f, 'utf8') } catch { continue }
        const methods: string[] = []
        for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
          if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src)) methods.push(m)
        }
        if (methods.length) results.push({ path: rel, methods })
      }
      results.sort((a, b) => a.path.localeCompare(b.path))
      return { routes: results, count: results.length }
    },
  },
  {
    name: 'call_admin_api',
    description: 'Call any /api/admin/* endpoint as the current admin. GET/HEAD requests run immediately and return the response. POST/PUT/PATCH/DELETE requests are PROPOSED — they queue an admin_agent_action that the admin must approve before the call fires. Use this when an existing dedicated tool does not cover the user\'s ask. Path must start with /api/admin/. Forbidden subpaths: /api/admin/agent/*, /api/admin/team*, /api/admin/admins*, /api/admin/auth*. Body cap 16KB.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'GET, HEAD, POST, PUT, PATCH, or DELETE' },
        path: { type: 'string', description: 'Absolute path starting with /api/admin/, e.g. /api/admin/quotations or /api/admin/orders/123' },
        body: { type: 'string', description: 'JSON-stringified request body (for POST/PUT/PATCH). Omit for GET/DELETE.' },
        queryString: { type: 'string', description: 'Query string fragment (e.g. "status=pending&limit=10"). Omit if not needed.' },
      },
      required: ['method', 'path'],
    },
    mutating: true,
    handler: async (input) => {
      const method = String(input.method || '').trim().toUpperCase()
      const rawPath = String(input.path || '').trim()
      const queryString = String(input.queryString || '').trim()
      const bodyStr = String(input.body || '').trim()

      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        throw new Error(`Unsupported method: ${method}`)
      }
      if (!rawPath.startsWith('/api/admin/')) {
        throw new Error('Path must start with /api/admin/')
      }
      const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
      if (FORBIDDEN_PATH_RE.test(rawPath)) {
        throw new Error('Path is not accessible to the agent (forbidden subpath)')
      }
      if (rawPath.includes('..') || rawPath.includes('://')) {
        throw new Error('Path is malformed')
      }
      if (bodyStr.length > 16 * 1024) throw new Error('Body too large (max 16KB)')
      if (bodyStr) {
        try { JSON.parse(bodyStr) } catch { throw new Error('body must be valid JSON') }
      }

      const fullPath = queryString ? `${rawPath}?${queryString}` : rawPath
      const isRead = method === 'GET' || method === 'HEAD'

      if (isRead) {
        return {
          proposed: false,
          executeImmediate: true,
          method, path: fullPath,
          marker: '__call_admin_api_immediate__',
        }
      }

      return {
        proposed: true,
        kind: 'call_admin_api',
        payload: { method, path: fullPath, body: bodyStr || null },
        confirmation: `${method} ${fullPath}${bodyStr ? ` with body (${bodyStr.length} bytes)` : ''} — admin must approve before the call fires.`,
      }
    },
  },
]

export function getTool(name: string): ToolDef | null {
  return TOOLS.find(t => t.name === name) || null
}

interface DynamicToolRow {
  id: string
  name: string
  description: string
  args_schema: Record<string, unknown>
  kind: 'readonly_sql' | 'templated_email'
}

export async function getApprovedDynamicTools(): Promise<DynamicToolRow[]> {
  const rows = await queryMany<DynamicToolRow>(
    `SELECT id::text, name, description, args_schema, kind
       FROM admin_agent_proposed_tools
      WHERE status = 'approved'
      ORDER BY name ASC`
  )
  return rows
}

