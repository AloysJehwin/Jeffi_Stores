#!/usr/bin/env node
/**
 * Smoke-test the AI assistant against RAG before/after catalog enrichment.
 *
 * Hits Razer pgvector for vector search (same path as src/lib/rag.ts) and
 * RDS via the SSH tunnel for hydrating product rows (same path as
 * searchCandidatesViaRag in src/lib/ai-assistant.ts).
 *
 * Outputs a markdown table with top-3 hits + similarity for each query.
 *
 * Usage:
 *   node scripts/smoke-ai-assistant.mjs --label=before
 *   node scripts/smoke-ai-assistant.mjs --label=after
 */

import pg from 'pg'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true']
  })
)

const LABEL = args.label || 'snapshot'

const RDS_URL = process.env.DATABASE_URL || 'postgresql://postgres:bbI5gNureU15E43j2wQbJCHykvO5@localhost:5433/jeffi_stores'
const RAZER_HOST = process.env.RAG_PG_HOST || '100.110.153.68'
const RAZER_PASS = process.env.RAG_PG_PASSWORD || 'bbI5gNureU15E43j2wQbJCHykvO5'
const OLLAMA_URL = (process.env.RAG_OLLAMA_URL || 'http://100.110.153.68:11434').replace(/\/$/, '')
const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'nomic-embed-text'

const QUERIES = [
  'car jack',
  'plumbing tools',
  'wrench set',
  'bottle jack',
  'spanner for hex bolts',
]

const rds   = new pg.Pool({ connectionString: RDS_URL, max: 4, ssl: { rejectUnauthorized: false } })
const razer = new pg.Pool({
  host: RAZER_HOST, port: 5432, user: 'postgres', password: RAZER_PASS, database: 'jeffi_dev', max: 2,
  connectionTimeoutMillis: 5000,
})

async function embed(text) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    return data.embedding
  } finally { clearTimeout(t) }
}

async function ragHits(query, k = 3) {
  const v = await embed(query)
  const lit = '[' + v.join(',') + ']'
  const { rows } = await razer.query(
    `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
       FROM embeddings
      WHERE source_table IN ('products','product_variants')
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [lit, k * 2]
  )
  const productIds = []
  for (const r of rows) {
    if (r.source_table === 'products' && !productIds.includes(r.source_id)) productIds.push(r.source_id)
  }
  const variantIds = rows.filter(r => r.source_table === 'product_variants').map(r => r.source_id)
  if (variantIds.length) {
    const vp = await rds.query(
      `SELECT id::text, product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
      [variantIds]
    )
    for (const r of vp.rows) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
  }
  if (!productIds.length) return []
  const products = await rds.query(
    `SELECT id::text, name, sku, ai_description, ai_use_cases
       FROM products WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
    [productIds.slice(0, k)]
  )
  const order = new Map(productIds.slice(0, k).map((id, i) => [id, i]))
  const sorted = products.rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
  return sorted.map((p, i) => {
    const sim = rows.find(r => r.source_id === p.id)?.sim ?? rows[i]?.sim
    return { ...p, sim: Number(sim || 0).toFixed(3) }
  })
}

async function main() {
  console.log(`# AI Assistant smoke test — ${LABEL}\n`)
  for (const q of QUERIES) {
    console.log(`## "${q}"\n`)
    try {
      const hits = await ragHits(q)
      if (!hits.length) { console.log('_no hits_\n'); continue }
      console.log('| # | sim | product | tags | enriched? |')
      console.log('|---|-----|---------|------|-----------|')
      hits.forEach((h, i) => {
        const tags = (h.ai_use_cases || []).slice(0, 4).join(', ') || '—'
        const enriched = h.ai_description ? 'yes' : 'no'
        console.log(`| ${i + 1} | ${h.sim} | ${h.name.slice(0, 50)} (${h.sku}) | ${tags} | ${enriched} |`)
      })
      console.log('')
    } catch (err) {
      console.log(`error: ${err.message}\n`)
    }
  }
  await rds.end()
  await razer.end()
}

main().catch(err => { console.error('fatal:', err); process.exit(1) })
