import { query, queryMany, queryOne } from './db'

const OPENAI_API = 'https://api.openai.com/v1/chat/completions'
const MODEL = 'gpt-4o-mini'
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
  inventory_quantity: number
  primary_image_url: string | null
}

export interface Recommendation {
  product: ProductCandidate
  quantity: number
  reason: string
}

export interface AssistantResult {
  summary: string
  recommendations: Recommendation[]
  responseMs: number
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
        p.id, p.name, p.slug, p.sku, p.base_price::text AS base_price,
        p.short_description, p.inventory_quantity,
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
       p.id, p.name, p.slug, p.sku, p.base_price::text AS base_price,
       p.short_description, p.inventory_quantity,
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

interface OpenAIChoice {
  message: { content: string }
  finish_reason: string
}

interface OpenAIResponse {
  choices: OpenAIChoice[]
  usage: { prompt_tokens: number; completion_tokens: number }
}

async function callOpenAI(userQuery: string, candidates: ProductCandidate[]): Promise<{
  summary: string
  recommendations: { product_id: string; quantity: number; reason: string }[]
  promptTokens: number
  completionTokens: number
}> {
  const systemPrompt = `You are a hardware product specialist for Jeffi Stores, an Indian industrial-hardware shop. A customer describes a project, intent, or just a vague topic. Your job: pick relevant products from the CATALOG below.

Hard rules:
- Only recommend products from the CATALOG. Never invent products. Use the exact product_id values provided.
- ALWAYS recommend at least 3 products and at most 8. Even if the query is vague, pick the closest plausible matches from the catalog.
- If the query is unrelated to hardware (e.g. "hello", "what is the weather"), still pick 3 generally useful products (popular fasteners or tools) and write a friendly summary that nudges the user toward describing a project.
- Suggest realistic quantities for the project scale. If unclear, default to a sensible small batch (e.g. 4-10 fasteners, 1-2 tools).
- Keep "reason" short (under 25 words): WHY this product fits, WHAT it would be used for.
- "summary" = 1-2 sentences. Acknowledge the user's intent, then describe what you're suggesting overall.
- Never return an empty recommendations array. If nothing seems perfect, pick the most relevant 3 anyway and explain how they might help.`

  const compactCatalog = candidates.map(c => ({
    id: c.id,
    name: c.name,
    sku: c.sku,
    brand: c.brand_name,
    category: c.category_name,
    price: c.base_price,
    description: c.short_description?.slice(0, 200),
  }))

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `CUSTOMER PROJECT: ${userQuery}\n\nCATALOG (${candidates.length} products):\n${JSON.stringify(compactCatalog, null, 0)}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'recommendations',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            recommendations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 },
                  reason: { type: 'string' },
                },
                required: ['product_id', 'quantity', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['summary', 'recommendations'],
          additionalProperties: false,
        },
      },
    },
    temperature: 0.4,
  }

  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = (await res.json()) as OpenAIResponse
  const content = data.choices[0]?.message?.content
  if (!content) throw new Error('Empty AI response')

  const parsed = JSON.parse(content) as { summary: string; recommendations: { product_id: string; quantity: number; reason: string }[] }
  return {
    summary: parsed.summary ?? '',
    recommendations: parsed.recommendations ?? [],
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  }
}

function estimateCostInr(promptTokens: number, completionTokens: number): number {
  const promptUsd = (promptTokens / 1_000_000) * 0.15
  const completionUsd = (completionTokens / 1_000_000) * 0.60
  return Math.round((promptUsd + completionUsd) * 88 * 10000) / 10000
}

export async function recommendProducts(userId: string, userQuery: string): Promise<AssistantResult> {
  const start = Date.now()

  const quota = await getRemainingQuota(userId)
  if (quota.remaining <= 0) {
    throw new Error(`Daily limit reached (${DAILY_LIMIT} queries). Resets at midnight.`)
  }

  const candidates = await searchCandidates(userQuery, 50)

  if (candidates.length === 0) {
    await query(
      `INSERT INTO ai_queries (user_id, query_text, candidate_count, recommended_count, response_ms, model)
       VALUES ($1, $2, 0, 0, $3, $4)`,
      [userId, userQuery.slice(0, 1000), Date.now() - start, MODEL]
    ).catch(() => {})
    return {
      summary: "I couldn't find anything in our catalog matching that description. Try different keywords or browse by category.",
      recommendations: [],
      responseMs: Date.now() - start,
    }
  }

  let aiResult: Awaited<ReturnType<typeof callOpenAI>>
  try {
    aiResult = await callOpenAI(userQuery, candidates)
  } catch (err: any) {
    await query(
      `INSERT INTO ai_queries (user_id, query_text, candidate_count, recommended_count, response_ms, model, error)
       VALUES ($1, $2, $3, 0, $4, $5, $6)`,
      [userId, userQuery.slice(0, 1000), candidates.length, Date.now() - start, MODEL, String(err?.message ?? err).slice(0, 500)]
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
  const cost = estimateCostInr(aiResult.promptTokens, aiResult.completionTokens)

  await query(
    `INSERT INTO ai_queries
       (user_id, query_text, candidate_count, recommended_count, response_ms, model, prompt_tokens, completion_tokens, cost_inr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, userQuery.slice(0, 1000), candidates.length, recommendations.length, responseMs, MODEL, aiResult.promptTokens, aiResult.completionTokens, cost]
  ).catch(() => {})

  return {
    summary: aiResult.summary,
    recommendations,
    responseMs,
  }
}
