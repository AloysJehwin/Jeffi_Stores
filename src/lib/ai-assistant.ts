import { query, queryMany, queryOne } from './db'
import { aiChat } from './ai-client'
import { findSimilarProductIds } from './rag'
import { VARIANT_MIN_PRICE_SQL } from './queries'

const MODEL_TAG = 'ai-client'
const DAILY_LIMIT = 10

export interface ProductCandidate {
  id: string
  name: string
  slug: string
  sku: string
  base_price: string
  brand_name: string | null
  category_name: string | null
  short_description: string | null
  ai_description: string | null
  ai_use_cases: string[] | null
  inventory_quantity: number
  primary_image_url: string | null
}

export interface Recommendation {
  product: ProductCandidate
  quantity: number
  reason: string
}

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','have','has','had',
  'i','i\'m','im','in','is','it','its','my','need','of','on','or','please',
  'planning','project','some','that','the','this','to','want','was','we','what',
  'will','with','you','your','give','me','build','building','make','making',
  'put','putting','do','can','could','would','should','about','like','want',
  'looking','any','few','also','just','really','help'
])

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w))
}

function escapeForFts(input: string): string {
  return tokenize(input).map(w => `${w}:*`).join(' | ')
}

export async function searchCandidatesViaRag(userQuery: string, limit = 20): Promise<ProductCandidate[]> {
  const ids = await findSimilarProductIds(userQuery, limit)
  if (ids.length === 0) return []

  const productIds = ids.filter(i => i.productId).map(i => i.productId)
  const variantIds = ids.filter(i => i.variantId).map(i => i.variantId as string)

  const productsByVariant = variantIds.length > 0
    ? await queryMany<{ id: string; product_id: string }>(
        `SELECT id::text, product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
        [variantIds]
      )
    : []
  for (const r of productsByVariant) {
    if (r.product_id && !productIds.includes(r.product_id)) productIds.push(r.product_id)
  }

  if (productIds.length === 0) return []

  const rows = await queryMany<ProductCandidate>(
    `SELECT
       p.id::text, p.name, p.slug, p.sku,
       COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS base_price,
       p.short_description, p.ai_description, p.ai_use_cases, p.inventory_quantity,
       b.name AS brand_name,
       c.name AS category_name,
       (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) AS primary_image_url
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
    [productIds]
  )

  const order = new Map(productIds.map((id, i) => [id, i]))
  return rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
}

export async function searchCandidates(userQuery: string, limit = 50): Promise<ProductCandidate[]> {
  const tokens = tokenize(userQuery)
  const tsQuery = tokens.map(w => `${w}:*`).join(' | ')
  const trgmQuery = tokens.join(' ').slice(0, 200) || userQuery.slice(0, 200)

  const ilikeFragments = tokens.length > 0
    ? tokens.map((_, i) => `(p.name ILIKE $${i + 4} OR p.short_description ILIKE $${i + 4} OR b.name ILIKE $${i + 4} OR c.name ILIKE $${i + 4})`).join(' OR ')
    : 'FALSE'
  const ilikeParams = tokens.map(w => `%${w}%`)

  const sql = `
    WITH ranked AS (
      SELECT
        p.id, p.name, p.slug, p.sku,
        COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS base_price,
        p.short_description, p.ai_description, p.ai_use_cases, p.inventory_quantity,
        b.name AS brand_name,
        c.name AS category_name,
        (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) AS primary_image_url,
        GREATEST(
          ${tsQuery ? `COALESCE(ts_rank(p.search_vector, to_tsquery('english', $1)), 0) * 4` : '0'},
          similarity(LOWER(p.name), LOWER($2)) * 3,
          similarity(LOWER(COALESCE(p.short_description, '')), LOWER($2)) * 1.5,
          similarity(LOWER(COALESCE(b.name, '')), LOWER($2)) * 2,
          similarity(LOWER(COALESCE(c.name, '')), LOWER($2)) * 2
        ) AS match_score
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = true
    )
    SELECT * FROM ranked
    WHERE match_score > 0.05
       ${ilikeFragments !== 'FALSE' ? `OR id IN (
         SELECT p.id FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = true AND (${ilikeFragments})
       )` : ''}
    ORDER BY match_score DESC
    LIMIT $3
  `

  const results = await queryMany<ProductCandidate & { match_score?: number }>(
    sql,
    [tsQuery || 'a:*', trgmQuery, limit, ...ilikeParams]
  )

  if (results.length > 0) return results

  return queryMany<ProductCandidate>(
    `SELECT
       p.id, p.name, p.slug, p.sku,
       COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS base_price,
       p.short_description, p.ai_description, p.ai_use_cases, p.inventory_quantity,
       b.name AS brand_name,
       c.name AS category_name,
       (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.display_order ASC LIMIT 1) AS primary_image_url
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
     ORDER BY p.is_featured DESC, p.created_at DESC
     LIMIT $1`,
    [limit]
  )
}

export async function getRemainingQuota(userId: string): Promise<{ used: number; remaining: number; resetAt: Date }> {
  const row = await queryOne<{ used: string }>(
    `SELECT COUNT(*)::text AS used
     FROM ai_queries
     WHERE user_id = $1
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
       AND error IS NULL`,
    [userId]
  )
  const used = parseInt(row?.used ?? '0', 10)
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  return { used, remaining: Math.max(0, DAILY_LIMIT - used), resetAt: tomorrow }
}

async function callRanker(userQuery: string, candidates: ProductCandidate[]): Promise<{
  summary: string
  recommendations: { product_id: string; quantity: number; reason: string }[]
  provider: string
  model: string
  latencyMs: number
}> {
  const systemPrompt = `You are a hardware product specialist for Jeffi Stores, an Indian industrial-hardware shop. A customer describes a project, intent, or just a vague topic. Your job: pick relevant products from the CATALOG below.

Hard rules:
- Only recommend products from the CATALOG. Never invent products. Use the exact product_id values provided.
- ALWAYS recommend at least 3 products and at most 8. Even if the query is vague, pick the closest plausible matches from the catalog.
- If the query is unrelated to hardware (e.g. "hello", "what is the weather"), still pick 3 generally useful products (popular fasteners or tools) and write a friendly summary that nudges the user toward describing a project.
- Suggest realistic quantities for the project scale. If unclear, default to a sensible small batch (e.g. 4-10 fasteners, 1-2 tools).
- Keep "reason" short (under 25 words): WHY this product fits, WHAT it would be used for.
- "summary" = 1-2 sentences. Acknowledge the user's intent, then describe what you're suggesting overall.
- Never return an empty recommendations array. If nothing seems perfect, pick the most relevant 3 anyway and explain how they might help.

Output ONLY a JSON object: {"summary": "...", "recommendations": [{"product_id": "...", "quantity": 1, "reason": "..."}]}`

  const compactCatalog = candidates.map(c => ({
    id: c.id,
    name: c.name,
    sku: c.sku,
    brand: c.brand_name,
    category: c.category_name,
    price: c.base_price,
    description: c.ai_description?.slice(0, 200) || c.short_description?.slice(0, 200),
    use_cases: c.ai_use_cases?.slice(0, 8),
  }))

  const r = await aiChat({
    modelHint: 'copy',
    jsonMode: true,
    temperature: 0.4,
    maxTokens: 2000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `CUSTOMER PROJECT: ${userQuery}\n\nCATALOG (${candidates.length} products):\n${JSON.stringify(compactCatalog, null, 0)}` },
    ],
  })

  const parsed = JSON.parse(r.content) as { summary?: string; recommendations?: { product_id: string; quantity: number; reason: string }[] }
  return {
    summary: parsed.summary ?? '',
    recommendations: parsed.recommendations ?? [],
    provider: r.provider,
    model: r.model,
    latencyMs: r.latencyMs,
  }
}

export interface AssistantResult {
  aiQueryId: string | null
  summary: string
  recommendations: Recommendation[]
  responseMs: number
  source: 'rag' | 'keyword' | 'none'
  provider: string
  model: string
}

export async function recommendProducts(userId: string, userQuery: string): Promise<AssistantResult> {
  const start = Date.now()

  const quota = await getRemainingQuota(userId)
  if (quota.remaining <= 0) {
    throw new Error(`Daily limit reached (${DAILY_LIMIT} queries). Resets at midnight.`)
  }

  let candidates: ProductCandidate[] = []
  let source: 'rag' | 'keyword' | 'none' = 'none'

  try {
    candidates = await searchCandidatesViaRag(userQuery, 20)
    if (candidates.length > 0) source = 'rag'
  } catch {
    candidates = []
  }

  if (candidates.length === 0) {
    candidates = await searchCandidates(userQuery, 50)
    if (candidates.length > 0) source = 'keyword'
  }

  if (candidates.length === 0) {
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO ai_queries (user_id, query_text, candidate_count, recommended_count, response_ms, model)
       VALUES ($1, $2, 0, 0, $3, $4) RETURNING id`,
      [userId, userQuery.slice(0, 1000), Date.now() - start, MODEL_TAG]
    ).catch(() => null)
    return {
      aiQueryId: inserted?.id ?? null,
      summary: "I couldn't find anything in our catalog matching that description. Try different keywords or browse by category.",
      recommendations: [],
      responseMs: Date.now() - start,
      source: 'none',
      provider: '',
      model: '',
    }
  }

  let aiResult: Awaited<ReturnType<typeof callRanker>>
  try {
    aiResult = await callRanker(userQuery, candidates)
  } catch (err: any) {
    await query(
      `INSERT INTO ai_queries (user_id, query_text, candidate_count, recommended_count, response_ms, model, error)
       VALUES ($1, $2, $3, 0, $4, $5, $6)`,
      [userId, userQuery.slice(0, 1000), candidates.length, Date.now() - start, MODEL_TAG, String(err?.message ?? err).slice(0, 500)]
    ).catch(() => {})
    throw new Error('AI service unavailable. Please try again.')
  }

  const candidateMap = new Map(candidates.map(c => [c.id, c]))
  const recommendations: Recommendation[] = aiResult.recommendations
    .map(r => {
      const product = candidateMap.get(r.product_id)
      if (!product) return null
      return { product, quantity: Math.max(1, Math.min(10000, r.quantity)), reason: r.reason.slice(0, 200) }
    })
    .filter((r): r is Recommendation => r !== null)

  const responseMs = Date.now() - start

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO ai_queries
       (user_id, query_text, candidate_count, recommended_count, response_ms, model, recommended_product_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[])
     RETURNING id`,
    [userId, userQuery.slice(0, 1000), candidates.length, recommendations.length, responseMs, `${aiResult.provider}:${aiResult.model}`, recommendations.map(r => r.product.id)]
  ).catch(() => null)

  return {
    aiQueryId: inserted?.id ?? null,
    summary: aiResult.summary,
    recommendations,
    responseMs,
    source,
    provider: aiResult.provider,
    model: aiResult.model,
  }
}
