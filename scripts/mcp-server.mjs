#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOG_DIR = path.join(os.homedir(), '.cache', 'jeffi-mcp')
const LOG_FILE = path.join(LOG_DIR, 'calls.log')
fs.mkdirSync(LOG_DIR, { recursive: true })

function logCall(toolName, input, result, errorMsg) {
  const entry = {
    ts: new Date().toISOString(),
    tool: toolName,
    input,
    ok: !errorMsg,
    error: errorMsg,
    output_size: result ? JSON.stringify(result).length : 0,
  }
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {})
}

const RAG_OLLAMA_URL = (process.env.RAG_OLLAMA_URL || 'http://100.110.153.68:11434').replace(/\/$/, '')
const RAG_EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'nomic-embed-text'
const RAG_PG = {
  host: process.env.RAG_PG_HOST || '100.110.153.68',
  port: parseInt(process.env.RAG_PG_PORT || '5432', 10),
  user: process.env.RAG_PG_USER || 'postgres',
  password: process.env.RAG_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD,
  database: process.env.RAG_PG_DB || 'jeffi_dev',
  max: 4,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
}

const APP_PG_URL = process.env.DATABASE_URL
const USE_IAM = process.env.RDS_IAM_AUTH === 'true'

let APP_PG
if (USE_IAM) {
  const { Signer } = await import('@aws-sdk/rds-signer')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const certCandidates = [
    path.join('/opt/jeffi-stores/certs/global-bundle.pem'),
    path.join(process.cwd(), 'certs', 'global-bundle.pem'),
  ]
  const certPath = certCandidates.find(p => fs.existsSync(p))
  const signer = new Signer({
    hostname: process.env.RDS_HOST,
    port: parseInt(process.env.RDS_PORT || '5432', 10),
    region: process.env.AWS_REGION || 'us-east-1',
    username: process.env.RDS_USER,
  })
  APP_PG = {
    host: process.env.RDS_HOST,
    port: parseInt(process.env.RDS_PORT || '5432', 10),
    user: process.env.RDS_USER,
    database: process.env.RDS_DB,
    password: () => signer.getAuthToken(),
    ssl: certPath
      ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
      : { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 5000,
  }
} else if (APP_PG_URL) {
  APP_PG = { connectionString: APP_PG_URL, max: 4, statement_timeout: 5000 }
} else {
  APP_PG = RAG_PG
}

const ragPool = new pg.Pool(RAG_PG)
const appPool = new pg.Pool(APP_PG)
ragPool.on('error', () => {})
appPool.on('error', () => {})

async function embed(text) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(`${RAG_OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: RAG_EMBED_MODEL, prompt: text }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data.embedding)) throw new Error('No embedding')
    return data.embedding
  } finally {
    clearTimeout(t)
  }
}

function vec(arr) { return '[' + arr.join(',') + ']' }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)) }

const TOOLS = [
  {
    name: 'search_products',
    description: 'Semantic product search over the catalog. Returns candidates ranked by similarity to the query. Use for "find me X" / "products like Y" queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language description of what you want.' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    handler: async ({ query, limit = 10 }) => {
      const lim = clamp(limit, 1, 50)
      const v = await embed(query)
      const ids = await ragPool.query(
        `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table IN ('products','product_variants')
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(v), lim * 2]
      )
      const productIds = []
      for (const r of ids.rows) {
        if (r.source_table === 'products' && !productIds.includes(r.source_id)) productIds.push(r.source_id)
      }
      const variantSrcIds = ids.rows.filter(r => r.source_table === 'product_variants').map(r => r.source_id)
      if (variantSrcIds.length) {
        const vp = await appPool.query(
          `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
          [variantSrcIds]
        )
        for (const r of vp.rows) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
      }
      if (productIds.length === 0) return { products: [], note: 'No matches found.' }
      const r = await appPool.query(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.base_price::text AS price, p.inventory_quantity AS stock,
                b.name AS brand, c.name AS category
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds.slice(0, lim)]
      )
      const order = new Map(productIds.map((id, i) => [id, i]))
      return { products: r.rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)) }
    },
  },
  {
    name: 'get_product',
    description: 'Fetch full product details by id or slug.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, slug: { type: 'string' } },
    },
    handler: async ({ id, slug }) => {
      if (!id && !slug) throw new Error('Provide id or slug')
      const r = await appPool.query(
        `SELECT p.id::text, p.name, p.slug, p.sku, p.short_description, p.description,
                p.base_price::text AS price, p.mrp::text AS mrp, p.gst_percentage,
                p.inventory_quantity AS stock, p.is_active, p.hsn_code,
                b.name AS brand, c.name AS category,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order LIMIT 1) AS image_url
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1::uuid OR p.slug = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', slug || '']
      )
      if (r.rows.length === 0) return { error: 'Product not found' }
      return r.rows[0]
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
    handler: async ({ productId }) => {
      const r = await appPool.query(
        `SELECT id::text, variant_name, sku, price::text, mrp::text, stock_quantity AS stock, is_active
         FROM product_variants WHERE product_id = $1::uuid ORDER BY variant_name`,
        [productId]
      )
      return { variants: r.rows }
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
    handler: async ({ productId, limit = 10 }) => {
      const lim = clamp(limit, 1, 50)
      const src = await ragPool.query(
        `SELECT embedding FROM embeddings WHERE source_table = 'products' AND source_id = $1 LIMIT 1`,
        [productId]
      )
      if (src.rows.length === 0) return { products: [], note: 'Product has no embedding yet.' }
      const r = await ragPool.query(
        `SELECT source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table = 'products' AND source_id != $2
         ORDER BY embedding <=> $1::vector LIMIT $3`,
        [src.rows[0].embedding, productId, lim]
      )
      const ids = r.rows.map(x => x.source_id)
      if (ids.length === 0) return { products: [] }
      const out = await appPool.query(
        `SELECT id::text, name, slug, sku, base_price::text AS price, inventory_quantity AS stock
         FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
        [ids]
      )
      return { products: out.rows }
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
    handler: async ({ query, limit = 10 }) => {
      const lim = clamp(limit, 1, 50)
      const v = await embed(query)
      const r = await ragPool.query(
        `SELECT source_id, 1 - (embedding <=> $1::vector) AS sim
         FROM embeddings WHERE source_table = 'users'
         ORDER BY embedding <=> $1::vector LIMIT $2`,
        [vec(v), lim]
      )
      const ids = r.rows.map(x => x.source_id)
      if (ids.length === 0) return { customers: [] }
      const out = await appPool.query(
        `SELECT u.id::text, u.email, u.first_name, u.last_name, u.phone, u.created_at,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::int AS paid_orders,
                COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::text AS lifetime_value
         FROM users u WHERE u.id = ANY($1::uuid[])`,
        [ids]
      )
      return { customers: out.rows }
    },
  },
  {
    name: 'get_customer',
    description: 'Fetch a customer by id or email, including order count and lifetime value.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, email: { type: 'string' } },
    },
    handler: async ({ id, email }) => {
      if (!id && !email) throw new Error('Provide id or email')
      const r = await appPool.query(
        `SELECT u.id::text, u.email, u.first_name, u.last_name, u.phone, u.is_guest, u.marketing_opt_out, u.created_at,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id), 0)::int AS total_orders,
                COALESCE((SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::int AS paid_orders,
                COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::text AS lifetime_value,
                (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
         FROM users u WHERE u.id = $1::uuid OR u.email = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', email || '']
      )
      if (r.rows.length === 0) return { error: 'Customer not found' }
      return r.rows[0]
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
    handler: async ({ userId, status, days = 7, limit = 20 }) => {
      const lim = clamp(limit, 1, 100)
      const d = clamp(days, 1, 365)
      const params = []
      const where = [`o.created_at > NOW() - ($1 || ' days')::interval`]
      params.push(d)
      if (userId) { params.push(userId); where.push(`o.user_id = $${params.length}::uuid`) }
      if (status) { params.push(status); where.push(`o.status = $${params.length}`) }
      params.push(lim)
      const r = await appPool.query(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status, o.total_amount::text, o.created_at,
                u.email AS customer_email, u.first_name || ' ' || u.last_name AS customer_name
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY o.created_at DESC LIMIT $${params.length}`,
        params
      )
      return { orders: r.rows, truncated: r.rows.length === lim }
    },
  },
  {
    name: 'get_order',
    description: 'Full order detail including line items and shipping address.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, orderNumber: { type: 'string' } },
    },
    handler: async ({ id, orderNumber }) => {
      if (!id && !orderNumber) throw new Error('Provide id or orderNumber')
      const o = await appPool.query(
        `SELECT o.id::text, o.order_number, o.status, o.payment_status, o.subtotal::text, o.discount_amount::text,
                o.tax_amount::text, o.shipping_amount::text, o.total_amount::text, o.notes, o.created_at, o.delivered_at,
                o.shipping_address_snapshot,
                u.email AS customer_email, u.first_name || ' ' || u.last_name AS customer_name, u.phone
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id = $1::uuid OR o.order_number = $2 LIMIT 1`,
        [id || '00000000-0000-0000-0000-000000000000', orderNumber || '']
      )
      if (o.rows.length === 0) return { error: 'Order not found' }
      const items = await appPool.query(
        `SELECT product_name, product_sku, variant_name, quantity::text, unit_price::text, total_price::text
         FROM order_items WHERE order_id = $1::uuid ORDER BY id`,
        [o.rows[0].id]
      )
      return { ...o.rows[0], items: items.rows }
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
    handler: async ({ threshold = 10, limit = 50 }) => {
      const lim = clamp(limit, 1, 200)
      const r = await appPool.query(
        `SELECT p.id::text, p.name, p.sku, p.inventory_quantity AS stock, p.base_price::text AS price, b.name AS brand
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.is_active = TRUE AND p.inventory_quantity <= $1
         ORDER BY p.inventory_quantity ASC, p.name ASC LIMIT $2`,
        [threshold, lim]
      )
      return { products: r.rows, threshold, count: r.rows.length, truncated: r.rows.length === lim }
    },
  },
  {
    name: 'get_campaign_stats',
    description: 'Performance for behavioral campaigns. Sent / opened / clicked / converted, optionally for a single campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Campaign kind slug (e.g. abandoned_cart). Omit for all.' },
        days: { type: 'integer', default: 30, minimum: 1, maximum: 365 },
      },
    },
    handler: async ({ kind, days = 30 }) => {
      const d = clamp(days, 1, 365)
      const params = [d]
      let where = `WHERE sent_at > NOW() - ($1 || ' days')::interval`
      if (kind) { params.push(kind); where += ` AND campaign_kind = $${params.length}` }
      const r = await appPool.query(
        `SELECT campaign_kind,
                COUNT(*)::int AS sent,
                COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
                COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
                COUNT(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted
         FROM email_campaigns_sent ${where} GROUP BY campaign_kind ORDER BY sent DESC`,
        params
      )
      return { window_days: d, campaigns: r.rows }
    },
  },
  {
    name: 'dry_run_audience',
    description: 'Estimate the audience size for a behavioral scenario without sending. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioKind: { type: 'string' },
      },
      required: ['scenarioKind'],
    },
    handler: async ({ scenarioKind }) => {
      const c = await appPool.query(
        `SELECT generated_sql FROM custom_scenarios WHERE kind = $1 AND enabled = TRUE`,
        [scenarioKind]
      )
      if (c.rows.length === 0) {
        return { error: 'Scenario not found or not custom-enabled. Built-in scenarios are not exposed via MCP yet.' }
      }
      const sql = c.rows[0].generated_sql
      const wrapped = `WITH q AS (${sql.replace(/;\s*$/, '')}) SELECT COUNT(*)::int AS audience_count FROM q`
      const client = await appPool.connect()
      try {
        await client.query('BEGIN READ ONLY')
        await client.query(`SET LOCAL statement_timeout = '5s'`)
        const r = await client.query(wrapped, [scenarioKind, 0, 1000000])
        await client.query('ROLLBACK')
        return { scenario: scenarioKind, ...r.rows[0] }
      } finally {
        client.release()
      }
    },
  },
  {
    name: 'list_tools',
    description: 'Return the names + descriptions of every tool this MCP server exposes. Use when an MCP client asks "what can you do?".',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      return { tools: TOOLS.map(t => ({ name: t.name, description: t.description, args: Object.keys(t.inputSchema.properties || {}) })) }
    },
  },
  {
    name: 'find_customer_orders',
    description: 'Look up a customer by name or email and return their orders, most-recent first. Use when an MCP client references "Aloys Jehwin\'s recent order" without an order number.',
    inputSchema: {
      type: 'object',
      properties: {
        customerQuery: { type: 'string' },
        limit: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
      },
      required: ['customerQuery'],
    },
    handler: async ({ customerQuery, limit = 10 }) => {
      const lim = clamp(limit, 1, 50)
      const q = String(customerQuery || '').trim()
      if (!q) throw new Error('customerQuery is required')
      const cust = await appPool.query(
        `SELECT id::text, email, first_name, last_name FROM users
          WHERE email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
             OR (first_name || ' ' || last_name) ILIKE $1
          ORDER BY (CASE WHEN email ILIKE $1 THEN 0 ELSE 1 END), created_at DESC
          LIMIT 5`,
        [`%${q}%`]
      )
      if (cust.rows.length === 0) return { customers: [], orders: [], note: 'No match.' }
      if (cust.rows.length > 1) return { customers: cust.rows, orders: [], note: 'Multiple matches — disambiguate.' }
      const c = cust.rows[0]
      const orders = await appPool.query(
        `SELECT id::text, order_number, status, payment_status, total_amount::text, created_at
           FROM orders WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
        [c.id, lim]
      )
      return {
        customer: { id: c.id, email: c.email, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() },
        orders: orders.rows,
      }
    },
  },
  {
    name: 'run_sql_readonly',
    description: 'Run a single read-only SELECT for ad-hoc questions the dedicated tools do not cover. Auto-wrapped in BEGIN READ ONLY with a 5s timeout, capped at 100 rows. Writes/DDL and access to admins/payment_methods/password columns are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string' },
      },
      required: ['sql'],
    },
    handler: async ({ sql }) => {
      const FORBIDDEN = /\b(admins|admin_agent_messages|admin_agent_actions|admin_sessions|payment_methods|razorpay_webhooks|webhook_events|password_hash|password|totp_secret|reset_token)\b/i
      const DML = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy|vacuum|analyze|reindex|comment|cluster|lock|listen|notify|set\s+role|reset\s+role)\b/i
      const raw = String(sql || '').trim().replace(/;\s*$/, '')
      if (!raw) throw new Error('sql is required')
      if (raw.length > 4000) throw new Error('sql too long (max 4000 chars)')
      if (raw.includes(';')) throw new Error('semicolons not allowed inside the statement')
      if (!/^(with\b|select\b)/i.test(raw)) throw new Error('only SELECT or WITH...SELECT is permitted')
      if (DML.test(raw)) throw new Error('write/DDL keywords forbidden')
      if (FORBIDDEN.test(raw)) throw new Error('query references a forbidden table or column')
      const guarded = `${raw} LIMIT 100`
      const client = await appPool.connect()
      try {
        await client.query('BEGIN READ ONLY')
        await client.query(`SET LOCAL statement_timeout = '5s'`)
        const result = await client.query(guarded)
        await client.query('ROLLBACK')
        return {
          rowCount: result.rowCount ?? result.rows.length,
          fields: result.fields?.map(f => f.name) || [],
          rows: result.rows.slice(0, 100),
          truncated: (result.rowCount ?? result.rows.length) >= 100,
        }
      } catch (err) {
        try { await client.query('ROLLBACK') } catch {}
        throw new Error(`SQL error: ${err.message || err}`)
      } finally {
        client.release()
      }
    },
  },
]

const server = new Server(
  { name: 'jeffi-stores', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find(t => t.name === req.params.name)
  if (!tool) {
    logCall(req.params.name, req.params.arguments, null, 'unknown_tool')
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true }
  }
  const args = req.params.arguments || {}
  try {
    const result = await tool.handler(args)
    logCall(tool.name, args, result, null)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    logCall(tool.name, args, null, msg)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write(`[jeffi-mcp] connected, ${TOOLS.length} tools available\n`)
