import { queryMany } from '@/lib/db'
import { findSimilarProductIds } from '@/lib/rag'
import { aiChat, AiClientError } from '@/lib/ai-client'
import { storefrontAiAllowed } from '@/lib/storefront-ai'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'
import { pickUnitPrice } from '@/lib/pricing'

// ── "Featured For You" recommender ─────────────────────────────────────────
// Turns a logged-in user's captured browsing/purchase signals into a curated
// list of product recommendations. Pipeline: aggregate signals → vector
// candidates (RAG) → LLM curation → hydrate to card shape. Every stage degrades
// gracefully so the homepage never breaks (vector → heuristic → best sellers;
// LLM optional).

export interface RecCard {
  id: string
  name: string
  slug: string
  has_variants: boolean
  base_price: number
  price_ex_gst: number | null
  mrp: number | null
  variant_min_price: number | null
  variant_min_mrp: number | null
  variant_stock_total: number | null
  stock_status: string | null
  discount_pct: number | null
  extra_delivery_days: number | null
  handling_days: number | null
  product_images: Array<{ image_url: string; thumbnail_url: string; is_primary: boolean; blurhash?: string | null }>
  brands: { name: string } | null
  categories: { name: string } | null
}

export type RecSource = 'vector' | 'heuristic' | 'bestsellers'

export interface RecResult {
  products: RecCard[]
  source: RecSource
  curated: boolean
  // logging metadata (for ai_queries)
  seedQuery: string
  candidateCount: number
  model?: string
  responseMs?: number
  promptTokens?: number
  completionTokens?: number
  error?: string
}

interface UserSignals {
  seedNames: string[]
  excludeIds: string[]
  topCategoryIds: string[]
  topBrandIds: string[]
}

// ── Cache ───────────────────────────────────────────────────────────────────
// Per-user result cache. The LLM step (gemma3:4b) can take ~6-20s, far too slow
// to run on every homepage navigation, so cache the finished card list briefly.
// Single Node server → an in-process Map is coherent; no DB table needed.
const CACHE_TTL_MS = 20 * 60 * 1000 // 20 minutes
const CACHE_MAX = 500
const cache = new Map<string, { result: RecResult; expires: number }>()

function cacheGet(userId: string): RecResult | null {
  const hit = cache.get(userId)
  if (!hit) return null
  if (hit.expires < nowMs()) {
    cache.delete(userId)
    return null
  }
  return hit.result
}

function cacheSet(userId: string, result: RecResult) {
  if (cache.size >= CACHE_MAX) {
    // Evict the oldest inserted entry (Map preserves insertion order).
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(userId, { result, expires: nowMs() + CACHE_TTL_MS })
}

// Date.now() is unavailable in some sandboxed runtimes; guard it.
function nowMs(): number {
  try {
    return Date.now()
  } catch {
    return 0
  }
}

// Reject if a promise doesn't settle within ms — used to fast-fail the vector
// tier when the RAG store is unreachable, so we degrade quickly.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rec-timeout')), ms)
    p.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// ── Hydration ─────────────────────────────────────────────────────────────
// Selects the SAME shape as the homepage getBestSellers/getFeaturedProducts
// queries so productCardProps() (page.tsx) / the client mapper render cards
// pixel-identical to the rest of the homepage.
function buildCardSelect(minPriceSql: string): string {
  return `
  SELECT p.*,
    json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
    json_build_object('id', b.id, 'name', b.name) AS brands,
    COALESCE(
      (SELECT json_agg(pi ORDER BY pi.display_order)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'::json
    ) AS product_images,
    ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
    ${minPriceSql} AS variant_min_price,
    ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN brands b ON p.brand_id = b.id
`
}

async function hydrate(ids: string[]): Promise<RecCard[]> {
  if (!ids.length) return []
  const { gstEnabled } = await getFeatureFlags()
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  const rows = await queryMany<RecCard>(
    `${buildCardSelect(MIN_PRICE_SQL)} WHERE p.is_active = true AND p.id = ANY($1::uuid[])`,
    [ids]
  )
  const order = new Map(ids.map((id, i) => [id, i]))
  return rows.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
}

// ── 1. Signal aggregation ───────────────────────────────────────────────────
export async function aggregateUserSignals(userId: string): Promise<UserSignals> {
  // Weighted, 30-day recency-decayed score per product across all behaviour
  // sources. Weights: purchased 5 > carted 4 > wishlist/review 3 > viewed 1.
  const rows = await queryMany<{
    product_id: string
    name: string
    category_id: string | null
    brand_id: string | null
    score: number
  }>(
    `
    WITH signals AS (
      SELECT oi.product_id, 5.0 AS w, o.created_at AS at
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = $1::uuid AND o.payment_status = 'paid' AND oi.product_id IS NOT NULL
      UNION ALL
      SELECT product_id, 4.0, created_at
        FROM cart_items WHERE user_id = $1::uuid AND product_id IS NOT NULL
      UNION ALL
      SELECT reference_id, CASE kind
               WHEN 'cart_item_added' THEN 4.0
               WHEN 'wishlist_added' THEN 3.0
               WHEN 'review_submitted' THEN 3.0
               ELSE 1.0 END, created_at
        FROM customer_activity_log
       WHERE user_id = $1::uuid AND reference_type = 'products' AND reference_id IS NOT NULL
         AND kind IN ('product_viewed','wishlist_added','cart_item_added','review_submitted')
      UNION ALL
      SELECT product_id, 1.0, created_at
        FROM product_views WHERE user_id = $1::uuid AND product_id IS NOT NULL
    ),
    scored AS (
      SELECT product_id,
             SUM(w * EXP(-EXTRACT(EPOCH FROM (now() - at)) / (86400.0 * 30))) AS score
        FROM signals GROUP BY product_id
    )
    SELECT s.product_id::text, p.name, p.category_id::text, p.brand_id::text, s.score
      FROM scored s JOIN products p ON p.id = s.product_id AND p.is_active = TRUE
     ORDER BY s.score DESC LIMIT 25
    `,
    [userId]
  )

  // Products the user already owns or has in cart — never re-recommend these.
  const owned = await queryMany<{ product_id: string }>(
    `
    SELECT DISTINCT oi.product_id::text AS product_id
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.user_id = $1::uuid AND o.payment_status = 'paid' AND oi.product_id IS NOT NULL
    UNION
    SELECT DISTINCT product_id::text FROM cart_items
     WHERE user_id = $1::uuid AND product_id IS NOT NULL
    `,
    [userId]
  )

  return {
    seedNames: rows
      .slice(0, 8)
      .map(r => r.name)
      .filter(Boolean),
    excludeIds: owned.map(r => r.product_id),
    topCategoryIds: [...new Set(rows.map(r => r.category_id).filter(Boolean) as string[])].slice(0, 6),
    topBrandIds: [...new Set(rows.map(r => r.brand_id).filter(Boolean) as string[])].slice(0, 6),
  }
}

// ── 2. Candidate generation (tiered) ─────────────────────────────────────────
async function bestSellerIds(excludeIds: string[], limit: number): Promise<string[]> {
  const rows = await queryMany<{ id: string }>(
    `SELECT p.id::text,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) AS total_sold
       FROM products p
      WHERE p.is_active = TRUE AND p.id <> ALL($1::uuid[])
      ORDER BY total_sold DESC, p.created_at DESC
      LIMIT $2`,
    [excludeIds.length ? excludeIds : ['00000000-0000-0000-0000-000000000000'], limit]
  )
  return rows.map(r => r.id)
}

export async function getCandidates(
  signals: UserSignals,
  limit = 24
): Promise<{ ids: string[]; source: RecSource; seedQuery: string }> {
  const excludeIds = signals.excludeIds
  const seedQuery = signals.seedNames.join(' ')

  // Tier 1 — vector similarity (RAG). Wrapped: embed()/RAG DB throw when the
  // Ollama box or vector store is unreachable. Raced against a hard deadline so
  // an unreachable RAG store degrades fast (~6s) instead of hanging on pg
  // connect timeouts and blocking the homepage.
  if (seedQuery && (await storefrontAiAllowed().catch(() => false))) {
    try {
      const similar = await withTimeout(findSimilarProductIds(seedQuery, limit), 6000)
      const excl = new Set(excludeIds)
      const ids: string[] = []
      const variantIds: string[] = []
      for (const r of similar) {
        if (r.matchedVia === 'products' && r.productId) {
          if (!excl.has(r.productId) && !ids.includes(r.productId)) ids.push(r.productId)
        } else if (r.matchedVia === 'product_variants' && r.variantId) {
          variantIds.push(r.variantId)
        }
      }
      if (variantIds.length) {
        const vp = await queryMany<{ product_id: string }>(
          `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`,
          [variantIds]
        )
        for (const r of vp) if (!excl.has(r.product_id) && !ids.includes(r.product_id)) ids.push(r.product_id)
      }
      if (ids.length >= 4) return { ids: ids.slice(0, limit), source: 'vector', seedQuery }
    } catch {
      // fall through to heuristic
    }
  }

  // Tier 2 — heuristic: products in the user's top categories/brands, best-selling first.
  if (signals.topCategoryIds.length || signals.topBrandIds.length) {
    const rows = await queryMany<{ id: string }>(
      `SELECT p.id::text,
              COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id), 0) AS total_sold
         FROM products p
        WHERE p.is_active = TRUE
          AND (p.category_id = ANY($1::uuid[]) OR p.brand_id = ANY($2::uuid[]))
          AND p.id <> ALL($3::uuid[])
        ORDER BY total_sold DESC, p.created_at DESC
        LIMIT $4`,
      [
        signals.topCategoryIds.length ? signals.topCategoryIds : ['00000000-0000-0000-0000-000000000000'],
        signals.topBrandIds.length ? signals.topBrandIds : ['00000000-0000-0000-0000-000000000000'],
        excludeIds.length ? excludeIds : ['00000000-0000-0000-0000-000000000000'],
        limit,
      ]
    )
    if (rows.length >= 4) return { ids: rows.map(r => r.id), source: 'heuristic', seedQuery }
  }

  // Tier 3 — best sellers (also the new-user / no-signal path). Always non-empty.
  return { ids: await bestSellerIds(excludeIds, limit), source: 'bestsellers', seedQuery }
}

// ── 3. LLM curation ───────────────────────────────────────────────────────
const CURATE_SYSTEM = (store: string) => `You are a product recommender for ${store}.
Given a shopper's recent interests and a numbered list of candidate products, pick and ORDER the best products for THIS shopper.
Return ONLY valid JSON using the candidate NUMBERS: {"picks":[<number>, <number>, ...]}
Rules: use only the numbers shown; order best-first; prefer variety across categories; return the requested count.`

interface CandidateMeta {
  id: string
  name: string
  category: string | null
  brand: string | null
  price: number
}

// Collapse a product name to its "family" — strips trailing size/variant tokens
// so "... Screw Metric 12.9 M4", "... M6", "... M10" all map to one family. This
// stops the row from filling with near-identical variants of the same product.
function familyKey(m: CandidateMeta): string {
  const base = (m.name || '')
    .toLowerCase()
    // drop common size/spec tokens: M6, 12.9, 250mm, 1/2", 1m, sizes, grades
    .replace(/\b[mM]\d+(\.\d+)?\b/g, ' ') // M6, M10, 12.9-style M-codes
    .replace(/\b\d+(\.\d+)?\s?(mm|cm|m|inch|in|")\b/g, ' ') // 250mm, 1m, 1/2"
    .replace(/\b\d+(\.\d+)?\b/g, ' ') // bare numbers/grades (12.9)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ') // first few descriptive words
  return `${m.brand ?? ''}|${m.category ?? ''}|${base}`
}

/**
 * Enforce variety on an ordered id list. Keeps the given order but limits how
 * many items share the same product family and the same brand+category, so a
 * pool dominated by one product line (e.g. all Unbrako screws) still yields a
 * varied row. Tops back up from the leftovers if the caps thin the list below
 * `want`, so the row is always filled.
 */
function diversify(orderedIds: string[], meta: Map<string, CandidateMeta>, want: number): string[] {
  const MAX_PER_FAMILY = 1
  const MAX_PER_BRAND_CAT = 2
  const famCount = new Map<string, number>()
  const brandCatCount = new Map<string, number>()
  const picked: string[] = []
  const deferred: string[] = []

  for (const id of orderedIds) {
    const m = meta.get(id)
    if (!m) continue
    const fk = familyKey(m)
    const bc = `${m.brand ?? ''}|${m.category ?? ''}`
    if ((famCount.get(fk) ?? 0) >= MAX_PER_FAMILY || (brandCatCount.get(bc) ?? 0) >= MAX_PER_BRAND_CAT) {
      deferred.push(id)
      continue
    }
    famCount.set(fk, (famCount.get(fk) ?? 0) + 1)
    brandCatCount.set(bc, (brandCatCount.get(bc) ?? 0) + 1)
    picked.push(id)
    if (picked.length >= want) break
  }
  // Fill remaining slots from deferred (keeps the row full when the pool is
  // narrow), preserving original order.
  if (picked.length < want) {
    for (const id of deferred) {
      if (!picked.includes(id)) picked.push(id)
      if (picked.length >= want) break
    }
  }
  return picked.slice(0, want)
}

async function curate(
  candidates: CandidateMeta[],
  signals: UserSignals,
  want: number
): Promise<{
  ids: string[]
  curated: boolean
  model?: string
  responseMs?: number
  promptTokens?: number
  completionTokens?: number
}> {
  const fallback = candidates.slice(0, want).map(c => c.id)
  if (candidates.length <= want) return { ids: fallback, curated: false }
  if (!(await storefrontAiAllowed().catch(() => false))) return { ids: fallback, curated: false }

  const interest = [
    signals.seedNames.length ? `Recently interested in: ${signals.seedNames.slice(0, 6).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Reference candidates by short 1-based INDEX, not UUID — small models (gemma3:4b)
  // reliably echo small integers but mangle/drop 36-char UUIDs.
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}${c.brand ? ` | ${c.brand}` : ''}${c.category ? ` | ${c.category}` : ''} | ₹${c.price}`
    )
    .join('\n')

  const userPrompt = `${interest}\n\nCandidates (numbered):\n${list}\n\nReturn the best ${want} as their numbers.`

  try {
    const { storeDescriptorForPrompt } = await import('@/lib/brand')
    const r = await aiChat({
      modelHint: 'fast',
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 400,
      messages: [
        { role: 'system', content: CURATE_SYSTEM(await storeDescriptorForPrompt()) },
        { role: 'user', content: userPrompt },
      ],
    })
    let parsed: { picks?: Array<number | string> }
    try {
      parsed = JSON.parse(r.content)
    } catch {
      const m = r.content
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : {}
    }
    // Map returned 1-based indexes → candidate ids; keep model order, dedup, drop out-of-range.
    const picks: string[] = []
    for (const raw of parsed.picks || []) {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
      const idx = n - 1
      if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) {
        const id = candidates[idx].id
        if (!picks.includes(id)) picks.push(id)
      }
    }
    // Top up from the original candidate order if the model under-picked, so we
    // always fill the row — the curation just reorders the front.
    if (picks.length < want) {
      for (const c of candidates) {
        if (!picks.includes(c.id)) picks.push(c.id)
        if (picks.length >= want) break
      }
    }
    if (picks.length === 0) return { ids: fallback, curated: false, model: r.model, responseMs: r.latencyMs }
    return {
      ids: picks.slice(0, want),
      curated: true,
      model: r.model,
      responseMs: r.latencyMs,
    }
  } catch (err) {
    if (!(err instanceof AiClientError)) {
      /* unexpected — still degrade */
    }
    return { ids: fallback, curated: false }
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────
export async function getFeaturedForUser(userId: string, want = 8): Promise<RecResult> {
  const cached = cacheGet(userId)
  if (cached) return cached

  const started = nowMs()
  const signals = await aggregateUserSignals(userId)
  const { ids: candidateIds, source, seedQuery } = await getCandidates(signals, Math.max(24, want * 3))

  // Hydrate candidates once — needed both for LLM metadata and final cards.
  const { gstEnabled } = await getFeatureFlags()
  const candidateCards = await hydrate(candidateIds)
  const candidateMeta: CandidateMeta[] = candidateCards.map(c => ({
    id: c.id,
    name: c.name,
    category: c.categories?.name ?? null,
    brand: c.brands?.name ?? null,
    price: Number(
      c.has_variants && c.variant_min_price != null
        ? c.variant_min_price
        : pickUnitPrice({ inclusive: c.base_price, exGst: c.price_ex_gst }, gstEnabled)
    ),
  }))

  // Only curate personalised (vector/heuristic) results; best-sellers are shown as-is.
  let picks: string[]
  let curated = false
  let model: string | undefined
  let responseMs: number | undefined
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  if (source === 'bestsellers') {
    picks = candidateIds.slice(0, want)
  } else {
    const c = await curate(candidateMeta, signals, want)
    picks = c.ids
    curated = c.curated
    model = c.model
    responseMs = c.responseMs
    promptTokens = c.promptTokens
    completionTokens = c.completionTokens
  }

  const byId = new Map(candidateCards.map(c => [c.id, c]))
  // Enforce variety so the row isn't filled with near-identical variants of the
  // same product line, regardless of what the candidate pool / LLM returned.
  const metaById = new Map(candidateMeta.map(m => [m.id, m]))
  const diversePicks = diversify(picks, metaById, want)
  const products = diversePicks.map(id => byId.get(id)).filter(Boolean) as RecCard[]

  const result: RecResult = {
    products,
    source,
    curated,
    seedQuery,
    candidateCount: candidateCards.length,
    model,
    responseMs: responseMs ?? nowMs() - started,
    promptTokens,
    completionTokens,
  }
  cacheSet(userId, result)
  return result
}

// Best-sellers list for logged-out visitors (no personalisation, not cached per-user).
export async function getBestSellerCards(want = 8): Promise<RecCard[]> {
  // Pull a wider pool then diversify so the row isn't all one product line.
  const ids = await bestSellerIds([], Math.max(24, want * 3))
  const cards = await hydrate(ids)
  const meta = new Map<string, CandidateMeta>(
    cards.map(c => [
      c.id,
      {
        id: c.id,
        name: c.name,
        category: c.categories?.name ?? null,
        brand: c.brands?.name ?? null,
        price: 0,
      },
    ])
  )
  const diverseIds = diversify(
    cards.map(c => c.id),
    meta,
    want
  )
  const byId = new Map(cards.map(c => [c.id, c]))
  return diverseIds.map(id => byId.get(id)).filter(Boolean) as RecCard[]
}
