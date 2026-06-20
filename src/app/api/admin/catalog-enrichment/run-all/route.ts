import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

const BATCH_LIMIT = 200
const RESTAGE_DAYS = 90

interface ProductRow {
  id: string
  name: string
  description: string | null
  sku: string | null
  material: string | null
  size: string | null
  category_name: string | null
  brand_name: string | null
}

interface Enrichment {
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[]
  ai_who_uses_it: string
  ai_application: string
  ai_product_type: string
  ai_features: string[]
  ai_search_tags: string[]
}

const SYSTEM_PROMPT = `You write product intelligence data for an Indian B2B/B2C hardware and tools store (jeffistores.com).
Given a product name, category, brand, and description, produce ALL of the following fields:

1. ai_description: A clear 1-2 sentence customer-facing description. No marketing fluff.
2. ai_use_cases: 4-10 short buyer search-intent phrases (e.g. "hang picture frame", "wall mounting"). Lowercase, 1-4 words each.
3. ai_keywords: 5-12 synonyms, alternate names, colloquial terms buyers use (e.g. "rawl plug", "wall anchor", "fischer plug"). Lowercase.
4. ai_who_uses_it: A short phrase describing who buys this (e.g. "electricians, contractors, DIY homeowners").
5. ai_application: One sentence on where/how it is used (e.g. "Used to hang picture frames and mirrors on plastered or brick walls").
6. ai_product_type: The normalized product type in 1-3 words (e.g. "Wall Anchor", "Hex Bolt", "Toggle Switch").
7. ai_features: 3-8 key product features or specs as short phrases (e.g. "rust resistant", "load rated 5 kg", "includes nail").
8. ai_search_tags: 5-15 broader context tags for semantic search (e.g. "hanging", "mounting", "home decor", "interior").

Rules:
- Only use facts from the input. Do not invent specs.
- All array values: lowercase, no duplicates, concise.
- Respond with strict JSON only — no prose, no markdown fences.

Schema:
{"ai_description":"...","ai_use_cases":["..."],"ai_keywords":["..."],"ai_who_uses_it":"...","ai_application":"...","ai_product_type":"...","ai_features":["..."],"ai_search_tags":["..."]}`

function buildPrompt(p: ProductRow): string {
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

function cleanArr(val: unknown, maxLen = 40, maxItems = 15): string[] {
  if (!Array.isArray(val)) return []
  return [...new Set(
    (val as unknown[]).map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= maxLen)
  )].slice(0, maxItems)
}

function parseEnrichment(raw: string): Enrichment {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw)
  } catch (err) {
    console.error('[route]', err)
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

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || 'http://100.82.208.8:11434').replace(/\/$/, '')
  const OLLAMA_MODEL = process.env.OLLAMA_COPY_MODEL || process.env.OLLAMA_AGENT_MODEL || 'qwen3:14b'

  const candidates = await queryMany<ProductRow>(
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
    [RESTAGE_DAYS, BATCH_LIMIT]
  )

  if (candidates.length === 0) {
    return NextResponse.json({ queued: 0, message: 'No products need enrichment' })
  }

  const RATE_MS = 12_000
  ;(async () => {
    let lastAt = 0
    for (const p of candidates) {
      try {
        const wait = RATE_MS - (Date.now() - lastAt)
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        lastAt = Date.now()

        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            format: 'json',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildPrompt(p) },
            ],
            options: { temperature: 0.3 },
          }),
        })
        if (!res.ok) continue
        const data = await res.json() as { message?: { content?: string } }
        const e = parseEnrichment(data.message?.content || '')

        const { query } = await import('@/lib/db')
        await query(
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
      } catch (err) {
        console.error('[route]', err)
        void 0
      }
    }
  })()

  return NextResponse.json({ queued: candidates.length, message: `Enriching ${candidates.length} products at 5/min — check back in ${Math.ceil(candidates.length / 5)} minutes` })
}
