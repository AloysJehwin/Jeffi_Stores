#!/usr/bin/env node
import pg from 'pg'
import crypto from 'node:crypto'
import { gatewayEmbed, gatewayUrl } from './lib/ai-gateway.mjs'

const PG_HOST = process.env.RAZER_PG_HOST || '100.82.208.8'
const PG_PORT = parseInt(process.env.RAZER_PG_PORT || '5432', 10)
const PG_USER = process.env.RAZER_PG_USER || 'jeffi_replica'
const PG_PASS = process.env.RAZER_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD
const PG_DB   = process.env.RAZER_PG_DB || 'jeffi_replica'
// Embeddings come from the AI gateway; EMBED_PROVIDER (razer | azure) overrides its default provider.
const EMBED_PROVIDER = process.env.EMBED_PROVIDER || undefined
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10)
const CONCURRENCY = parseInt(process.env.EMBED_CONCURRENCY || '4', 10)
// Which tenant these embeddings belong to (#489). Default null = the platform/flagship's own rows.
// Pass --tenant <uuid> or TENANT_ID=<uuid> to backfill one tenant's catalog into its own namespace,
// so a tenant's RAG only ever sees its own vectors.
const TENANT_ID =
  (process.argv.find(a => a.startsWith('--tenant='))?.split('=')[1] ?? process.env.TENANT_ID) || null

if (!PG_PASS) {
  console.error('ERROR: RAZER_PG_PASSWORD or RDS_MASTER_PASSWORD must be set')
  process.exit(1)
}

const pool = new pg.Pool({
  host: PG_HOST, port: PG_PORT, user: PG_USER, password: PG_PASS, database: PG_DB,
  max: 8,
  // RDS requires SSL; set PG_SSL=1 to enable (cert not verified — fine over the SSH tunnel).
  ssl: process.env.PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
})

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex') }

async function embed(text) {
  const r = await gatewayEmbed(text, { provider: EMBED_PROVIDER })
  return { vector: r.vectors[0], model: r.model }
}

// The model the gateway embeds with now; a row embedded by another model is redone (vectors never mix).
let currentModel = null

function vectorLiteral(v) {
  return '[' + v.join(',') + ']'
}

const SOURCES = [
  {
    table: 'products',
    sql: `SELECT id::text AS id, name, description, sku, brand_id, category_id, base_price, mrp, gst_percentage FROM products`,
    text: r => [
      r.name,
      r.sku ? `SKU: ${r.sku}` : '',
      r.description ? `Description: ${r.description}` : '',
      r.base_price ? `Price: ₹${r.base_price}` : '',
    ].filter(Boolean).join(' | '),
  },
  {
    table: 'product_variants',
    sql: `SELECT pv.id::text AS id, pv.variant_name, pv.sku, pv.price, pv.mrp, p.name AS product_name FROM product_variants pv LEFT JOIN products p ON p.id = pv.product_id WHERE pv.is_active = TRUE`,
    text: r => [
      r.product_name ? `${r.product_name} -` : '',
      r.variant_name,
      r.sku ? `SKU: ${r.sku}` : '',
      r.price ? `Price: ₹${r.price}` : '',
    ].filter(Boolean).join(' '),
  },
  {
    table: 'users',
    sql: `SELECT id::text AS id, email, first_name, last_name, phone, is_guest, marketing_opt_out, created_at FROM users WHERE is_guest = FALSE AND email IS NOT NULL`,
    text: r => [
      `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Customer',
      r.email,
      r.phone || '',
      r.created_at ? `Joined: ${new Date(r.created_at).toISOString().slice(0,10)}` : '',
    ].filter(Boolean).join(' | '),
  },
  {
    table: 'orders',
    sql: `SELECT o.id::text AS id, o.order_number, o.status, o.payment_status, o.total_amount, o.created_at, u.email, u.first_name, u.last_name FROM orders o LEFT JOIN users u ON u.id = o.user_id`,
    text: r => [
      `Order ${r.order_number}`,
      `Status: ${r.status}/${r.payment_status}`,
      `Total: ₹${r.total_amount}`,
      r.email ? `Customer: ${`${r.first_name||''} ${r.last_name||''}`.trim()} (${r.email})` : '',
      r.created_at ? `Placed: ${new Date(r.created_at).toISOString().slice(0,10)}` : '',
    ].filter(Boolean).join(' | '),
  },
  {
    table: 'campaigns',
    sql: `SELECT kind AS id, name, description, scenario_kind FROM campaigns`,
    text: r => [
      r.name,
      r.description || '',
      r.scenario_kind ? `Scenario: ${r.scenario_kind}` : '',
    ].filter(Boolean).join(' | '),
  },
  {
    table: 'coupons',
    sql: `SELECT id::text AS id, code, description, discount_type, discount_value FROM coupons WHERE is_active = TRUE`,
    text: r => [
      r.code,
      r.description || '',
      r.discount_type === 'percentage' ? `${r.discount_value}% off` : `₹${r.discount_value} off`,
    ].filter(Boolean).join(' | '),
  },
]

async function processSource(src) {
  console.log(`\n━━ ${src.table} ━━`)
  const client = await pool.connect()
  let rows
  try {
    const r = await client.query(src.sql)
    rows = r.rows
  } finally {
    client.release()
  }
  console.log(`  rows: ${rows.length}`)

  const existingHashes = new Map()
  {
    const r = await pool.query(
      `SELECT source_id, content_hash, COALESCE(embedding_model, 'nomic-embed-text') AS model FROM embeddings
        WHERE source_table = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [src.table, TENANT_ID]
    )
    for (const row of r.rows) existingHashes.set(row.source_id, `${row.content_hash}|${row.model}`)
  }

  let embedded = 0, skipped = 0, errors = 0
  const queue = [...rows]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const row = queue.shift()
      if (!row) break
      const content = src.text(row).slice(0, 4000)
      if (!content.trim()) { skipped++; continue }
      const hash = sha256(content)
      if (existingHashes.get(String(row.id)) === `${hash}|${currentModel}`) { skipped++; continue }
      try {
        const { vector, model } = await embed(content)
        await pool.query(
          `INSERT INTO embeddings (tenant_id, source_table, source_id, content, content_hash, embedding, embedding_model, updated_at)
           VALUES ($6, $1, $2, $3, $4, $5::vector, $7, NOW())
           ON CONFLICT (tenant_id, source_table, source_id)
           DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                         embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = NOW()`,
          [src.table, String(row.id), content, hash, vectorLiteral(vector), TENANT_ID, model]
        )
        embedded++
        if (embedded % BATCH_SIZE === 0) process.stdout.write(`    progress: ${embedded}/${rows.length}\r`)
      } catch (err) {
        errors++
        if (errors <= 3) console.error(`  error on ${src.table}/${row.id}:`, err.message)
      }
    }
  })
  await Promise.all(workers)
  console.log(`  done: embedded=${embedded} skipped=${skipped} errors=${errors}`)
  return { table: src.table, embedded, skipped, errors }
}

(async () => {
  const start = Date.now()
  currentModel = (await embed('model probe')).model
  console.log(`AI gateway: ${gatewayUrl()}  embedding model: ${currentModel}`)
  console.log(`postgres: ${PG_USER}@${PG_HOST}:${PG_PORT}/${PG_DB}`)

  const results = []
  for (const src of SOURCES) {
    try {
      results.push(await processSource(src))
    } catch (err) {
      console.error(`  FATAL on ${src.table}:`, err.message)
      results.push({ table: src.table, embedded: 0, skipped: 0, errors: -1 })
    }
  }

  console.log(`\n━━ summary (${Math.round((Date.now()-start)/1000)}s) ━━`)
  for (const r of results) console.log(`  ${r.table.padEnd(20)} embedded=${r.embedded} skipped=${r.skipped} errors=${r.errors}`)
  await pool.end()
})().catch(err => { console.error(err); process.exit(1) })
