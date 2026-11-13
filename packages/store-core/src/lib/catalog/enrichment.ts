import { query, queryOne } from '@/lib/shared/db'
import { ENRICH_CONTENT_FIELDS, type EnrichContentKey } from './enrichment-fields'

export { ENRICH_CONTENT_FIELDS, type EnrichContentKey }

// AI catalog enrichment, shared by the bulk run, the save-time trigger and the approve routes.
// The model proposes; an admin approves. ai_* columns are replaced on approve; the shopper-facing
// content fields below only fill when the product's own value is empty, and FAQs only when it has none.

export const ENRICH_SELECT = `p.id::text, p.name, p.description, p.sku, p.material, p.size,
       p.short_description, p.color, p.model_number, p.series, p.pack_size, p.in_the_box,
       p.specifications, p.certifications, p.target_audience,
       p.usage_instructions, p.care_instructions, p.safety_warnings, p.meta_title, p.meta_description,
       c.name AS category_name, b.name AS brand_name`
export const ENRICH_JOINS = `LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b     ON b.id = p.brand_id`

export interface EnrichSource {
  id: string
  name: string
  description: string | null
  sku: string | null
  material: string | null
  size: string | null
  category_name: string | null
  brand_name: string | null
  short_description?: string | null
  color?: string | null
  model_number?: string | null
  series?: string | null
  pack_size?: string | null
  in_the_box?: string | null
  specifications?: unknown
  certifications?: string[] | null
  target_audience?: string[] | null
  usage_instructions?: string | null
  care_instructions?: string | null
  safety_warnings?: string | null
  meta_title?: string | null
  meta_description?: string | null
}

export interface Faq {
  question: string
  answer: string
}

export interface Enrichment {
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[]
  ai_who_uses_it: string
  ai_application: string
  ai_product_type: string
  ai_features: string[]
  ai_search_tags: string[]
  short_description: string | null
  usage_instructions: string | null
  care_instructions: string | null
  safety_warnings: string | null
  meta_title: string | null
  meta_description: string | null
  faqs: Faq[]
}


// Examples are store-neutral: the store's niche comes from the descriptor.
export const enrichmentSystemPrompt = (store: string) => `You write product intelligence data for ${store}.
Given a product's details, produce ALL of the following fields:

1. ai_description: A clear 1-2 sentence customer-facing description. No marketing fluff.
2. ai_use_cases: 4-10 short buyer search-intent phrases describing what the product is used for. Lowercase, 1-4 words each.
3. ai_keywords: 5-12 synonyms, alternate names and colloquial terms buyers use for this product. Lowercase.
4. ai_who_uses_it: A short phrase describing who buys this.
5. ai_application: One sentence on where/how it is used.
6. ai_product_type: The normalized product type in 1-3 words.
7. ai_features: 3-8 key product features or specs as short phrases.
8. ai_search_tags: 5-15 broader context tags for semantic search.
9. short_description: One or two plain sentences shown near the price (max 300 characters).
10. usage_instructions: How to use the product, 2-6 short steps or sentences, one per line.
11. care_instructions: How to clean, store or maintain it, 1-4 lines. "" if care does not apply (e.g. software).
12. safety_warnings: Sensible safety cautions for this kind of product, 1-4 lines. "" if none apply.
13. meta_title: An SEO page title, max 60 characters, product name first.
14. meta_description: An SEO meta description, 120-155 characters, plain and factual.
15. faqs: 3-5 questions a buyer would ask before purchasing, with 1-3 sentence answers.

Rules:
- Only use facts from the input. Do not invent specs, measurements, certifications, ratings, prices, warranty terms or delivery promises.
- Instructions, care and safety may give general guidance that follows from the product type; never state a specific claim the input does not support.
- For fields 9-14: when the input marks the field "(already set)", return "" for it. When "FAQs already exist", return "faqs": [].
- Stay within this store's product category; do not assume an industry the input does not show.
- All array values in fields 2-8: lowercase, no duplicates, concise.
- Respond with strict JSON only — no prose, no markdown fences.

Schema:
{"ai_description":"...","ai_use_cases":["..."],"ai_keywords":["..."],"ai_who_uses_it":"...","ai_application":"...","ai_product_type":"...","ai_features":["..."],"ai_search_tags":["..."],"short_description":"...","usage_instructions":"...","care_instructions":"...","safety_warnings":"...","meta_title":"...","meta_description":"...","faqs":[{"question":"...","answer":"..."}]}`

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0

function specLines(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object') return null
  const rows = Array.isArray(spec)
    ? spec.map((s: any) => (s && typeof s === 'object' ? [s.label ?? s.key ?? s.name, s.value] : [null, s]))
    : Object.entries(spec as Record<string, unknown>)
  const out = rows
    .filter(([, v]) => v != null && String(v).trim())
    .slice(0, 25)
    .map(([k, v]) => (k ? `${k}: ${v}` : String(v)))
  return out.length ? out.join('; ').slice(0, 1500) : null
}

export function buildEnrichmentPrompt(p: EnrichSource, hasFaqs = false): string {
  const list = (v: string[] | null | undefined) => (v?.length ? v.join(', ') : null)
  const lines = [
    `Name: ${p.name}`,
    p.category_name ? `Category: ${p.category_name}` : null,
    p.brand_name ? `Brand: ${p.brand_name}` : null,
    p.sku ? `SKU: ${p.sku}` : null,
    p.description ? `Existing description: ${p.description}` : 'Existing description: (empty)',
    p.material ? `Material: ${p.material}` : null,
    p.size ? `Size: ${p.size}` : null,
    p.color ? `Colour: ${p.color}` : null,
    p.model_number ? `Model number: ${p.model_number}` : null,
    p.series ? `Series: ${p.series}` : null,
    p.pack_size ? `Pack size: ${p.pack_size}` : null,
    p.in_the_box ? `In the box: ${p.in_the_box.replace(/\s*\n\s*/g, '; ')}` : null,
    list(p.certifications) ? `Certifications: ${list(p.certifications)}` : null,
    list(p.target_audience) ? `Audience: ${list(p.target_audience)}` : null,
    specLines(p.specifications) ? `Specifications: ${specLines(p.specifications)}` : null,
    ...ENRICH_CONTENT_FIELDS.map(f => (filled(p[f.key]) ? `${f.label} (already set): ${String(p[f.key]).slice(0, 300)}` : null)),
    hasFaqs ? 'FAQs already exist.' : null,
  ]
  return lines.filter(Boolean).join('\n')
}

export function cleanArr(val: unknown, maxLen = 40, maxItems = 15): string[] {
  if (!Array.isArray(val)) return []
  return [
    ...new Set((val as unknown[]).map(c => String(c).toLowerCase().trim()).filter(c => c && c.length <= maxLen)),
  ].slice(0, maxItems)
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}

function cleanFaqs(v: unknown): Faq[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  return v
    .map((f: any) => ({ question: String(f?.question ?? '').trim().slice(0, 300), answer: String(f?.answer ?? '').trim().slice(0, 2000) }))
    .filter(f => f.question && f.answer && !seen.has(f.question.toLowerCase()) && seen.add(f.question.toLowerCase()))
    .slice(0, 5)
}

export function parseEnrichment(raw: string): Enrichment {
  let obj: Record<string, unknown>
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
  const content = Object.fromEntries(ENRICH_CONTENT_FIELDS.map(f => [f.key, text(obj[f.key], f.max)])) as Record<EnrichContentKey, string | null>
  return {
    ai_description: desc,
    ai_use_cases: use_cases,
    ai_keywords: cleanArr(obj.ai_keywords, 50, 15),
    ai_who_uses_it: String(obj.ai_who_uses_it || '').trim().slice(0, 300),
    ai_application: String(obj.ai_application || '').trim().slice(0, 500),
    ai_product_type: String(obj.ai_product_type || '').trim().slice(0, 100),
    ai_features: cleanArr(obj.ai_features, 100, 10),
    ai_search_tags: cleanArr(obj.ai_search_tags, 50, 20),
    ...content,
    faqs: cleanFaqs(obj.faqs),
  }
}

/** Stores a proposal for review. Drops content the product already has, so review shows only fills. */
export async function insertEnrichmentProposal(p: EnrichSource, e: Enrichment, model: string) {
  const keep = (k: EnrichContentKey) => (filled(p[k]) ? null : e[k])
  await query(
    `INSERT INTO product_ai_enrichment_log
       (product_id, source_name, source_desc,
        ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
        ai_application, ai_product_type, ai_features, ai_search_tags,
        model, status,
        short_description, usage_instructions, care_instructions, safety_warnings,
        meta_title, meta_description, faqs)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'proposed',$13,$14,$15,$16,$17,$18,$19::jsonb)`,
    [
      p.id,
      p.name,
      p.description || null,
      e.ai_description,
      e.ai_use_cases,
      e.ai_keywords,
      e.ai_who_uses_it,
      e.ai_application,
      e.ai_product_type,
      e.ai_features,
      e.ai_search_tags,
      model,
      keep('short_description'),
      keep('usage_instructions'),
      keep('care_instructions'),
      keep('safety_warnings'),
      keep('meta_title'),
      keep('meta_description'),
      e.faqs.length ? JSON.stringify(e.faqs) : null,
    ]
  )
}

/** Log columns a promotion reads. */
export const ENRICH_LOG_SELECT = `id::text, product_id::text,
            ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
            ai_application, ai_product_type, ai_features, ai_search_tags,
            short_description, usage_instructions, care_instructions, safety_warnings,
            meta_title, meta_description, faqs`

export interface EnrichmentLogRow {
  id: string
  product_id: string
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[] | null
  ai_who_uses_it: string | null
  ai_application: string | null
  ai_product_type: string | null
  ai_features: string[] | null
  ai_search_tags: string[] | null
  short_description?: string | null
  usage_instructions?: string | null
  care_instructions?: string | null
  safety_warnings?: string | null
  meta_title?: string | null
  meta_description?: string | null
  faqs?: Faq[] | null
}

/** Writes an approved proposal onto the product. */
export async function promoteEnrichment(row: EnrichmentLogRow) {
  await query(
    `UPDATE products
        SET ai_description = $1, ai_use_cases = $2,
            ai_keywords = $3, ai_who_uses_it = $4, ai_application = $5,
            ai_product_type = $6, ai_features = $7, ai_search_tags = $8,
            short_description  = COALESCE(NULLIF(btrim(short_description), ''), $10),
            usage_instructions = COALESCE(NULLIF(btrim(usage_instructions), ''), $11),
            care_instructions  = COALESCE(NULLIF(btrim(care_instructions), ''), $12),
            safety_warnings    = COALESCE(NULLIF(btrim(safety_warnings), ''), $13),
            meta_title         = COALESCE(NULLIF(btrim(meta_title), ''), $14),
            meta_description   = COALESCE(NULLIF(btrim(meta_description), ''), $15),
            ai_enriched_at = NOW(), updated_at = NOW()
      WHERE id = $9::uuid`,
    [
      row.ai_description,
      row.ai_use_cases,
      row.ai_keywords,
      row.ai_who_uses_it,
      row.ai_application,
      row.ai_product_type,
      row.ai_features,
      row.ai_search_tags,
      row.product_id,
      row.short_description ?? null,
      row.usage_instructions ?? null,
      row.care_instructions ?? null,
      row.safety_warnings ?? null,
      row.meta_title ?? null,
      row.meta_description ?? null,
    ]
  )
  const faqs = cleanFaqs(row.faqs)
  if (faqs.length) {
    await query(
      `INSERT INTO product_faqs (product_id, question, answer, sort_order, published)
       SELECT $1::uuid, f.v->>'question', f.v->>'answer', f.ord::int - 1, true
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS f(v, ord)
        WHERE NOT EXISTS (SELECT 1 FROM product_faqs WHERE product_id = $1::uuid)`,
      [row.product_id, JSON.stringify(faqs)]
    )
  }
}

/** Rebuilds the product's search embedding in the current store's own DB (#489). */
export async function reEmbedProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { embed } = await import('@/lib/shared/rag')
    const product = await queryOne<{
      name: string
      sku: string | null
      ai_description: string | null
      description: string | null
      ai_use_cases: string[] | null
      ai_keywords: string[] | null
      ai_who_uses_it: string | null
      ai_application: string | null
      ai_product_type: string | null
      ai_features: string[] | null
      ai_search_tags: string[] | null
      short_description?: string | null
      usage_instructions?: string | null
    }>(
      `SELECT name, sku, ai_description, description, ai_use_cases,
              ai_keywords, ai_who_uses_it, ai_application, ai_product_type,
              ai_features, ai_search_tags, short_description, usage_instructions
         FROM products WHERE id = $1::uuid`,
      [productId]
    )
    if (!product) return { ok: false, error: 'product not found for embed' }

    const desc = product.ai_description || product.description || ''
    const content = [
      product.name,
      product.sku ? `SKU: ${product.sku}` : '',
      product.ai_product_type ? `Type: ${product.ai_product_type}` : '',
      product.short_description ? `Summary: ${product.short_description}` : '',
      desc ? `Description: ${desc}` : '',
      product.ai_application ? `Application: ${product.ai_application}` : '',
      product.ai_who_uses_it ? `Used by: ${product.ai_who_uses_it}` : '',
      (product.ai_use_cases || []).length ? `Use cases: ${product.ai_use_cases!.join(', ')}` : '',
      (product.ai_keywords || []).length ? `Keywords: ${product.ai_keywords!.join(', ')}` : '',
      (product.ai_features || []).length ? `Features: ${product.ai_features!.join(', ')}` : '',
      (product.ai_search_tags || []).length ? `Tags: ${product.ai_search_tags!.join(', ')}` : '',
      product.usage_instructions ? `How to use: ${product.usage_instructions.slice(0, 600)}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const vec = await embed(content)
    const vecLit = '[' + vec.join(',') + ']'
    const crypto = await import('node:crypto')
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    const tenantId = await resolveTenantId()
    await query(
      `INSERT INTO embeddings (tenant_id, source_table, source_id, content, content_hash, embedding, updated_at)
       VALUES ($5, 'products', $1, $2, $3, $4::vector, NOW())
       ON CONFLICT (tenant_id, source_table, source_id)
       DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                     embedding = EXCLUDED.embedding, updated_at = NOW()`,
      [productId, content, hash, vecLit, tenantId]
    )
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'embed failed' }
  }
}
