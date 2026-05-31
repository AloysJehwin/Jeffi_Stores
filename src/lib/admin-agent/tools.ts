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
    name: 'get_recent_products',
    description: 'Top N most-recently-added active products by created_at DESC. Use for "newly added products" / "what is new" queries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
      },
    },
    mutating: false,
    handler: async ({ limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 20)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description, p.inventory_quantity AS stock,
                b.name AS brand, c.name AS category, p.created_at
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.is_active = TRUE
          ORDER BY p.created_at DESC
          LIMIT $1`,
        [lim]
      )
      return { products: rows, count: rows.length }
    },
  },
  {
    name: 'get_featured_products',
    description: 'Active products curated as featured (is_featured=true), ordered by sales_count DESC. Use when the user asks for "featured products" / "showcase products".',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
      },
    },
    mutating: false,
    handler: async ({ limit }) => {
      const lim = clamp(typeof limit === 'number' ? limit : 5, 1, 20)
      const rows = await queryMany(
        `SELECT p.id::text, p.name, p.slug, p.sku,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description, p.inventory_quantity AS stock,
                b.name AS brand, c.name AS category, p.sales_count
           FROM products p
           LEFT JOIN brands b ON b.id = p.brand_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.is_active = TRUE AND p.is_featured = TRUE
          ORDER BY p.sales_count DESC NULLS LAST, p.created_at DESC
          LIMIT $1`,
        [lim]
      )
      return { products: rows, count: rows.length }
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
    name: 'propose_new_tool',
    description: 'Propose a new admin-agent capability when no existing tool fits the user\'s ask. Use ONLY when the user describes a recurring action you cannot do with the existing tools — e.g. "I want to be able to send a refund email" or "give me a way to query monthly revenue per category". The proposed tool will be reviewed and approved separately by an admin BEFORE it can be invoked. Hard limits: kind must be readonly_sql (a single SELECT, no writes) OR templated_email (sends a templated email). The admin will see the source_prompt, name, args, and template before approving.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'snake_case name unique to this tool. Should describe the action.' },
        description: { type: 'string', description: 'One-sentence description of what the tool does and when to use it.' },
        kind: { type: 'string', description: 'readonly_sql or templated_email' },
        argsSchema: { type: 'string', description: 'JSON-encoded JSON schema describing the args. Stringify the object — do not embed it raw.' },
        sqlTemplate: { type: 'string', description: 'For kind=readonly_sql: a single SELECT statement. Use $1, $2 etc. for args in declared order. No semicolons. No DML/DDL. Must reference real tables.' },
        emailSubject: { type: 'string', description: 'For kind=templated_email: the subject line. May reference {{argName}}.' },
        emailBody: { type: 'string', description: 'For kind=templated_email: plain-text body. May reference {{argName}}.' },
        emailRecipientArg: { type: 'string', description: 'For kind=templated_email: the args key whose value is the recipient email.' },
        sourcePrompt: { type: 'string', description: 'The original user request that motivated this proposal. Used in the audit trail.' },
      },
      required: ['name', 'description', 'kind', 'argsSchema', 'sourcePrompt'],
    },
    mutating: true,
    handler: async (input) => {
      const name = String(input.name || '').trim().toLowerCase()
      const description = String(input.description || '').trim()
      const kind = String(input.kind || '').toLowerCase()
      const sourcePrompt = String(input.sourcePrompt || '').trim()
      if (!/^[a-z][a-z0-9_]{2,40}$/.test(name)) throw new Error('name must be snake_case, 3-40 chars')
      if (!description || description.length < 10) throw new Error('description too short')
      if (!sourcePrompt) throw new Error('sourcePrompt is required for the audit trail')
      if (!['readonly_sql', 'templated_email'].includes(kind)) {
        throw new Error('kind must be readonly_sql or templated_email')
      }

      let argsSchema: Record<string, unknown>
      try { argsSchema = JSON.parse(String(input.argsSchema || '{}')) } catch { throw new Error('argsSchema must be valid JSON') }
      if (typeof argsSchema !== 'object' || argsSchema === null) throw new Error('argsSchema must be a JSON object')

      let sqlTemplate: string | null = null
      let emailTemplate: { subject: string; body: string; recipientArg: string } | null = null

      if (kind === 'readonly_sql') {
        sqlTemplate = String(input.sqlTemplate || '').trim().replace(/;\s*$/, '')
        if (!sqlTemplate) throw new Error('sqlTemplate is required for kind=readonly_sql')
        if (sqlTemplate.includes(';')) throw new Error('semicolons not allowed in sqlTemplate')
        if (!/^(with\b|select\b)/i.test(sqlTemplate)) throw new Error('sqlTemplate must start with SELECT or WITH')
        if (SQL_DML_RE.test(sqlTemplate)) throw new Error('sqlTemplate contains forbidden DML/DDL keywords')
        if (SQL_BLOCKLIST_RE.test(sqlTemplate)) throw new Error('sqlTemplate references forbidden tables/columns')
      } else {
        const subject = String(input.emailSubject || '').trim()
        const body = String(input.emailBody || '').trim()
        const recipientArg = String(input.emailRecipientArg || '').trim()
        if (!subject || !body || !recipientArg) {
          throw new Error('emailSubject, emailBody, emailRecipientArg required for kind=templated_email')
        }
        if (subject.length > 120) throw new Error('emailSubject too long (max 120)')
        if (body.length > 4000) throw new Error('emailBody too long (max 4000)')
        emailTemplate = { subject, body, recipientArg }
      }

      const exists = await queryOne<{ id: string }>(
        `SELECT id::text FROM admin_agent_proposed_tools WHERE name = $1 AND status IN ('proposed','approved') LIMIT 1`,
        [name]
      )
      if (exists) {
        return { proposed: false, info: `A ${exists.id ? 'tool' : 'proposal'} named "${name}" already exists. Pick a different name or use the existing one.` }
      }

      return {
        proposed: true,
        kind: 'register_dynamic_tool',
        payload: {
          name,
          description,
          dynamicKind: kind,
          argsSchema,
          sqlTemplate,
          emailTemplate,
          sourcePrompt,
        },
        confirmation: `Register a new ${kind === 'readonly_sql' ? 'read-only SQL' : 'templated email'} tool called "${name}"? It will only become callable after a SECOND admin approval on the proposed-tools review page.`,
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

