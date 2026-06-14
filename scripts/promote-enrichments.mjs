#!/usr/bin/env node
/**
 * Bulk-approve every proposed enrichment in product_ai_enrichment_log.
 * Mirrors src/app/api/admin/catalog-enrichment/[id]/approve/route.ts
 * but runs at the DB layer for smoke tests, without admin auth.
 *
 * Writes ai_description / ai_use_cases to RDS, marks log row promoted,
 * and re-embeds the product on Razer's pgvector store using the
 * concatenated name + ai_description + tags.
 */

import pg from 'pg'
import crypto from 'node:crypto'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true']
  })
)

const RDS_URL = process.env.DATABASE_URL
const RAZER_HOST = process.env.RAG_PG_HOST || '100.82.208.8'
const RAZER_PASS = process.env.RAG_PG_PASSWORD
if (!RDS_URL || !RAZER_PASS) {
  console.error('DATABASE_URL and RAG_PG_PASSWORD env vars are required')
  process.exit(1)
}
const OLLAMA_URL = (process.env.RAG_OLLAMA_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'nomic-embed-text'
const LIMIT = parseInt(args.limit || '500', 10)

const NEEDS_SSL = /amazonaws|sslmode=require|localhost:5433/.test(RDS_URL)
const rds = new pg.Pool({ connectionString: RDS_URL, max: 4, ssl: NEEDS_SSL ? { rejectUnauthorized: false } : undefined })
const razer = new pg.Pool({
  host: RAZER_HOST, port: 5432, user: 'postgres', password: RAZER_PASS, database: 'jeffi_dev',
  max: 2, connectionTimeoutMillis: 5000,
})

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!Array.isArray(data.embedding)) throw new Error('No embedding')
  return data.embedding
}

async function reEmbed(productId) {
  const r = await rds.query(
    `SELECT name, sku, ai_description, description, ai_use_cases
       FROM products WHERE id = $1::uuid`,
    [productId]
  )
  if (!r.rows[0]) return { ok: false, error: 'product not found' }
  const p = r.rows[0]
  const desc = p.ai_description || p.description || ''
  const tags = (p.ai_use_cases || []).join(', ')
  const content = [
    p.name,
    p.sku ? `SKU: ${p.sku}` : '',
    desc ? `Description: ${desc}` : '',
    tags ? `Use cases: ${tags}` : '',
  ].filter(Boolean).join('\n')
  const vec = await embed(content)
  const lit = '[' + vec.join(',') + ']'
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  await razer.query(
    `INSERT INTO embeddings (source_table, source_id, content, content_hash, embedding, updated_at)
     VALUES ('products', $1, $2, $3, $4::vector, NOW())
     ON CONFLICT (source_table, source_id)
     DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                   embedding = EXCLUDED.embedding, updated_at = NOW()`,
    [productId, content, hash, lit]
  )
  return { ok: true }
}

async function main() {
  const proposed = await rds.query(
    `SELECT id::text, product_id::text, ai_description, ai_use_cases
       FROM product_ai_enrichment_log
      WHERE status = 'proposed'
      ORDER BY proposed_at ASC LIMIT $1`,
    [LIMIT]
  )
  console.log(`approving ${proposed.rows.length} enrichments`)
  let ok = 0, embedFail = 0
  for (const row of proposed.rows) {
    await rds.query(
      `UPDATE product_ai_enrichment_log
          SET status = 'approved', decided_at = NOW(), promoted_at = NOW()
        WHERE id = $1::uuid`,
      [row.id]
    )
    await rds.query(
      `UPDATE products
          SET ai_description = $1, ai_use_cases = $2, ai_enriched_at = NOW(), updated_at = NOW()
        WHERE id = $3::uuid`,
      [row.ai_description, row.ai_use_cases, row.product_id]
    )
    try {
      await reEmbed(row.product_id)
      await rds.query(
        `UPDATE product_ai_enrichment_log SET re_embedded_at = NOW() WHERE id = $1::uuid`,
        [row.id]
      )
      ok++
      process.stdout.write(`  + ${ok}/${proposed.rows.length}\r`)
    } catch (err) {
      embedFail++
      await rds.query(
        `UPDATE product_ai_enrichment_log SET error = $1 WHERE id = $2::uuid`,
        [err.message, row.id]
      )
    }
  }
  console.log(`\ndone: promoted=${ok} embedFailed=${embedFail}`)
  await rds.end()
  await razer.end()
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
