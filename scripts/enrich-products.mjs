#!/usr/bin/env node
/**
 * Catalog enrichment pipeline.
 *
 * For products with empty/short description (or stale ai_enriched_at), call the
 * copy LLM (Ollama qwen3:14b) to produce 8 ai_ fields:
 *   ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
 *   ai_application, ai_product_type, ai_features, ai_search_tags
 *
 * Output is staged into product_ai_enrichment_log with status='proposed'.
 * Promotion happens via the admin approval queue, NOT here.
 *
 * Usage:
 *   node scripts/enrich-products.mjs --limit=50
 *   node scripts/enrich-products.mjs --limit=5 --dry-run
 *   node scripts/enrich-products.mjs --product=<uuid>
 *
 * Env:
 *   DATABASE_URL        postgres://... (live RDS via tunnel by default)
 *   OLLAMA_BASE_URL     default http://100.110.153.68:11434 (Razer)
 *   OLLAMA_COPY_MODEL   default qwen3:14b
 *   ENRICH_RESTAGE_DAYS default 90
 */

import pg from 'pg'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true']
  })
)

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required')
  process.exit(1)
}
const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || 'http://100.110.153.68:11434').replace(/\/$/, '')
const OLLAMA_MODEL = process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'
const RESTAGE_DAYS = parseInt(process.env.ENRICH_RESTAGE_DAYS || '90', 10)
const LIMIT = parseInt(args.limit || '25', 10)
const DRY_RUN = args['dry-run'] === 'true'
const PRODUCT_FILTER = args.product || null

const NEEDS_SSL = /amazonaws|sslmode=require|localhost:5433/.test(DATABASE_URL)
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 4,
  ssl: NEEDS_SSL ? { rejectUnauthorized: false } : undefined,
})

const RATE_LIMIT_MS = 12_000
let lastCallAt = 0
async function rateLimitedCallOllama(userPrompt) {
  const wait = RATE_LIMIT_MS - (Date.now() - lastCallAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastCallAt = Date.now()
  return callOllama(userPrompt)
}

const SYSTEM_PROMPT = `You write product intelligence data for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Given a product name, category, brand, and description, produce ALL of the following fields:
1. ai_description: A clear 1-2 sentence customer-facing description. No marketing fluff.
2. ai_use_cases: 4-10 short buyer search-intent phrases (e.g. "hang picture frame"). Lowercase, 1-4 words.
3. ai_keywords: 5-12 synonyms and alternate names buyers use. Lowercase.
4. ai_who_uses_it: Short phrase on who buys this (e.g. "electricians, contractors, DIY homeowners").
5. ai_application: One sentence on where/how it is used.
6. ai_product_type: Normalized product type in 1-3 words (e.g. "Wall Anchor").
7. ai_features: 3-8 key features or specs as short phrases.
8. ai_search_tags: 5-15 broader semantic search tags.
Rules: Only use facts from input. All arrays lowercase, no duplicates. Strict JSON only.
Schema: {"ai_description":"...","ai_use_cases":["..."],"ai_keywords":["..."],"ai_who_uses_it":"...","ai_application":"...","ai_product_type":"...","ai_features":["..."],"ai_search_tags":["..."]}`

function buildUserPrompt(p) {
  return [
    `Name: ${p.name}`,
    p.category_name ? `Category: ${p.category_name}` : null,
    p.brand_name ? `Brand: ${p.brand_name}` : null,
    p.sku ? `SKU: ${p.sku}` : null,
    p.description ? `Existing description: ${p.description}` : 'Existing description: (empty)',
    p.material ? `Material: ${p.material}` : null,
    p.size ? `Size: ${p.size}` : null,
  ].filter(Boolean).join('\n')
}

async function callOllama(userPrompt) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.3 },
    }),
  })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.message?.content || ''
}

function cleanArr(val, maxLen = 40, maxItems = 15) {
  if (!Array.isArray(val)) return []
  return [...new Set(val.map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= maxLen))].slice(0, maxItems)
}

function parseEnrichment(raw) {
  let obj
  try {
    obj = JSON.parse(raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('No JSON in LLM response')
    obj = JSON.parse(m[0])
  }
  const desc = String(obj.ai_description || '').trim()
  if (!desc || desc.length < 20) throw new Error('ai_description too short')
  const use_cases = cleanArr(obj.ai_use_cases, 50, 12)
  if (use_cases.length < 2) throw new Error('not enough use cases')
  return {
    ai_description: desc,
    ai_use_cases: use_cases,
    ai_keywords: cleanArr(obj.ai_keywords, 50, 15),
    ai_who_uses_it: String(obj.ai_who_uses_it || '').trim().slice(0, 300),
    ai_application: String(obj.ai_application || '').trim().slice(0, 500),
    ai_product_type: String(obj.ai_product_type || '').trim().slice(0, 100),
    ai_features: cleanArr(obj.ai_features, 100, 10),
    ai_search_tags: cleanArr(obj.ai_search_tags, 50, 20),
  }
}

async function fetchCandidates() {
  if (PRODUCT_FILTER) {
    const { rows } = await pool.query(
      `SELECT p.id::text, p.name, p.description, p.sku, p.material, p.size,
              c.name AS category_name, b.name AS brand_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b     ON b.id = p.brand_id
       WHERE p.id = $1::uuid`,
      [PRODUCT_FILTER]
    )
    return rows
  }
  const { rows } = await pool.query(
    `SELECT p.id::text, p.name, p.description, p.sku, p.material, p.size,
            c.name AS category_name, b.name AS brand_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b     ON b.id = p.brand_id
     WHERE p.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM product_ai_enrichment_log l
         WHERE l.product_id = p.id
           AND l.status IN ('proposed','approved')
           AND l.proposed_at > NOW() - ($1 || ' days')::interval
       )
     ORDER BY p.sales_count DESC NULLS LAST, p.created_at DESC
     LIMIT $2`,
    [RESTAGE_DAYS, LIMIT]
  )
  return rows
}

async function stage(p, e) {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${p.name}`)
    console.log(`    type: ${e.ai_product_type}`)
    console.log(`    desc: ${e.ai_description}`)
    console.log(`    tags: ${e.ai_use_cases.join(', ')}`)
    console.log(`    keywords: ${e.ai_keywords.join(', ')}`)
    return
  }
  await pool.query(
    `INSERT INTO product_ai_enrichment_log
       (product_id, source_name, source_desc,
        ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
        ai_application, ai_product_type, ai_features, ai_search_tags,
        model, status)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed')`,
    [p.id, p.name, p.description || null,
     e.ai_description, e.ai_use_cases, e.ai_keywords, e.ai_who_uses_it,
     e.ai_application, e.ai_product_type, e.ai_features, e.ai_search_tags,
     OLLAMA_MODEL]
  )
}

async function main() {
  console.log(`enrich-products: model=${OLLAMA_MODEL} limit=${LIMIT} dryRun=${DRY_RUN}`)
  const candidates = await fetchCandidates()
  console.log(`candidates: ${candidates.length}`)

  let ok = 0, errors = 0
  for (const p of candidates) {
    try {
      const raw = await rateLimitedCallOllama(buildUserPrompt(p))
      const enrichment = parseEnrichment(raw)
      await stage(p, enrichment)
      console.log(`  + ${p.name.slice(0, 60)}  [${enrichment.ai_product_type}] (${enrichment.ai_use_cases.length} tags)`)
      ok++
    } catch (err) {
      console.warn(`  ! ${p.name?.slice(0, 60)}: ${err.message}`)
      errors++
    }
  }

  console.log(`done: staged=${ok} errors=${errors}`)
  await pool.end()
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
