#!/usr/bin/env node
/**
 * Catalog enrichment pipeline.
 *
 * For products with empty/short description (or stale ai_enriched_at), call the
 * copy LLM (Ollama llama3.1:8b-instruct via ai-client semantics) to produce:
 *   - ai_description: a clear, customer-facing 1-2 sentence rewrite
 *   - ai_use_cases:   a tag list of typical purchase intents (e.g. "car jack",
 *                     "hydraulic jack", "bottle jack" for a car-jack product)
 *
 * Output is staged into product_ai_enrichment_log with status='proposed'.
 * Promotion happens via the admin agent's approval queue, NOT here.
 *
 * Usage:
 *   node scripts/enrich-products.mjs --limit=50
 *   node scripts/enrich-products.mjs --limit=5 --dry-run
 *   node scripts/enrich-products.mjs --product=<uuid>
 *
 * Env:
 *   DATABASE_URL                postgres://... (live RDS via tunnel by default)
 *   OLLAMA_BASE_URL             default http://100.110.153.68:11434 (Razer)
 *   OLLAMA_COPY_MODEL           default qwen3:14b (was llama3.1 — removed from Razer in May 2026)
 *   ENRICH_MIN_DESC_CHARS       default 40 — products with shorter desc are picked
 *   ENRICH_RESTAGE_DAYS         default 90 — re-propose if existing log row is older
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
const MIN_DESC_CHARS = parseInt(process.env.ENRICH_MIN_DESC_CHARS || '40', 10)
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

const SYSTEM_PROMPT = `You write concise product copy for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Given a product's name, category, and existing description, produce:
  1. A clear 1-2 sentence customer-facing description.
  2. A list of 4-10 short search-intent tags a buyer might type — synonyms, common names,
     application contexts, and informal vernacular (e.g. "car jack", "hydraulic jack",
     "bottle jack", "vehicle lift" for a hydraulic bottle jack).

Tags must be lowercase, 1-3 words each, no duplicates, no marketing fluff, no SKU/brand noise.
Respond with strict JSON only — no prose, no markdown fences.

Schema:
{"ai_description": "...", "ai_use_cases": ["tag1","tag2",...]}`

function buildUserPrompt(p) {
  const lines = [
    `Name: ${p.name}`,
    p.category_name ? `Category: ${p.category_name}` : null,
    p.brand_name ? `Brand: ${p.brand_name}` : null,
    p.sku ? `SKU: ${p.sku}` : null,
    p.description ? `Existing description: ${p.description}` : 'Existing description: (empty)',
    p.material ? `Material: ${p.material}` : null,
    p.size ? `Size: ${p.size}` : null,
  ].filter(Boolean)
  return lines.join('\n')
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
  const cases = Array.isArray(obj.ai_use_cases) ? obj.ai_use_cases : []
  const cleanCases = [...new Set(
    cases.map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= 40)
  )].slice(0, 12)
  if (!desc || desc.length < 20) throw new Error('ai_description too short')
  if (cleanCases.length < 2) throw new Error('not enough use cases')
  return { ai_description: desc, ai_use_cases: cleanCases }
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
       AND p.ai_enriched_at IS NULL
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

async function stage(p, enrichment) {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${p.name}`)
    console.log(`    desc: ${enrichment.ai_description}`)
    console.log(`    tags: ${enrichment.ai_use_cases.join(', ')}`)
    return
  }
  await pool.query(
    `INSERT INTO product_ai_enrichment_log
       (product_id, source_name, source_desc, ai_description, ai_use_cases, model, status)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, 'proposed')`,
    [p.id, p.name, p.description || null, enrichment.ai_description, enrichment.ai_use_cases, OLLAMA_MODEL]
  )
}

async function main() {
  console.log(`enrich-products: model=${OLLAMA_MODEL} limit=${LIMIT} dryRun=${DRY_RUN}`)
  const candidates = await fetchCandidates()
  console.log(`candidates: ${candidates.length}`)

  let ok = 0, skipped = 0, errors = 0
  for (const p of candidates) {
    try {
      const userPrompt = buildUserPrompt(p)
      const raw = await callOllama(userPrompt)
      const enrichment = parseEnrichment(raw)
      await stage(p, enrichment)
      console.log(`  + ${p.name.slice(0, 60)}  (${enrichment.ai_use_cases.length} tags)`)
      ok++
    } catch (err) {
      console.warn(`  ! ${p.name?.slice(0, 60)}: ${err.message}`)
      errors++
    }
  }

  console.log(`done: staged=${ok} errors=${errors} skipped=${skipped}`)
  await pool.end()
}

main().catch(err => {
  console.error('fatal:', err)
  process.exit(1)
})
