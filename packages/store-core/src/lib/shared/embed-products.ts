// Per-tenant product embedding backfill. Generates vector embeddings for the CURRENT TENANT's active
// products and upserts them into that tenant's own `embeddings` table (via db.ts — the same place the
// customer-agent product search and admin catalog search read from). Shared by the embed_sync cron and
// the one-time backfill script. Mirrors the content string + upsert of the catalog-enrichment writer
// (src/app/api/(admin)/admin/catalog-enrichment/[id]/approve/route.ts).
import crypto from 'node:crypto'
import { query, queryMany } from '@/lib/shared/db'
import { embedWithModel, LEGACY_EMBED_MODEL } from '@/lib/shared/rag'

interface ProductRow {
  id: string
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
  brand_name: string | null
  category_name: string | null
}

function buildContent(p: ProductRow): string {
  const desc = p.ai_description || p.description || ''
  return [
    p.name,
    p.sku ? `SKU: ${p.sku}` : '',
    p.brand_name ? `Brand: ${p.brand_name}` : '',
    p.category_name ? `Category: ${p.category_name}` : '',
    p.ai_product_type ? `Type: ${p.ai_product_type}` : '',
    desc ? `Description: ${desc}` : '',
    p.ai_application ? `Application: ${p.ai_application}` : '',
    p.ai_who_uses_it ? `Used by: ${p.ai_who_uses_it}` : '',
    (p.ai_use_cases || []).length ? `Use cases: ${p.ai_use_cases!.join(', ')}` : '',
    (p.ai_keywords || []).length ? `Keywords: ${p.ai_keywords!.join(', ')}` : '',
    (p.ai_features || []).length ? `Features: ${p.ai_features!.join(', ')}` : '',
    (p.ai_search_tags || []).length ? `Tags: ${p.ai_search_tags!.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface BackfillResult {
  total: number
  embedded: number
  skipped: number
  failed: number
}

/**
 * Embed every active product in the current tenant's catalog into its own `embeddings` table.
 * `onlyMissing` (default true) skips products whose stored content_hash matches AND whose row was
 * embedded by the current model, so switching the platform embed provider re-embeds a store
 * progressively through the cron. `force` re-embeds everything. `limit` bounds a single run.
 */
export async function backfillProductEmbeddings(
  opts: { onlyMissing?: boolean; force?: boolean; limit?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<BackfillResult> {
  const onlyMissing = (opts.onlyMissing ?? true) && !opts.force
  const limit = opts.limit ?? 1000

  const products = await queryMany<ProductRow>(
    `SELECT p.id::text, p.name, p.sku, p.ai_description, p.description, p.ai_use_cases,
            p.ai_keywords, p.ai_who_uses_it, p.ai_application, p.ai_product_type,
            p.ai_features, p.ai_search_tags, b.name AS brand_name,
            NULLIF(concat_ws(' > ', pc.name, c.name), '') AS category_name
       FROM products p
       LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_category_id
      WHERE p.is_active = TRUE
      ORDER BY p.updated_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  )

  // Existing hashes, to skip unchanged rows without a per-product SELECT.
  const existing = new Map<string, { hash: string; model: string }>()
  if (onlyMissing && products.length) {
    const rows = await queryMany<{ source_id: string; content_hash: string | null; embedding_model: string | null }>(
      `SELECT source_id, content_hash, embedding_model FROM embeddings WHERE source_table = 'products'`
    )
    for (const r of rows) if (r.content_hash) existing.set(r.source_id, { hash: r.content_hash, model: r.embedding_model || LEGACY_EMBED_MODEL })
  }
  // The model the gateway embeds with now; learned from a probe the first time a hash match needs it.
  let currentModel: string | null = null

  const result: BackfillResult = { total: products.length, embedded: 0, skipped: 0, failed: 0 }

  let done = 0
  for (const p of products) {
    const content = buildContent(p)
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const prev = existing.get(p.id)
    if (onlyMissing && prev?.hash === hash) {
      if (currentModel === null) {
        try {
          currentModel = (await embedWithModel('model probe')).model
        } catch {
          currentModel = prev.model
        }
      }
      if (prev.model === currentModel) {
        result.skipped++
        opts.onProgress?.(++done, products.length)
        continue
      }
    }
    try {
      const { vector: vec, model } = await embedWithModel(content)
      currentModel = model
      const vecLit = '[' + vec.join(',') + ']'
      // Upsert into the tenant's own DB; tenant_id is resolved by db.ts's tenant context writers.
      // Within a tenant DB every row is that tenant's, so we stamp the resolved id for consistency.
      const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
      const tenantId = await resolveTenantId()
      await query(
        `INSERT INTO embeddings (tenant_id, source_table, source_id, content, content_hash, embedding, embedding_model, updated_at)
         VALUES ($5, 'products', $1, $2, $3, $4::vector, $6, NOW())
         ON CONFLICT (tenant_id, source_table, source_id)
         DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                       embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, updated_at = NOW()`,
        [p.id, content, hash, vecLit, tenantId, model]
      )
      result.embedded++
    } catch {
      result.failed++
    }
    opts.onProgress?.(++done, products.length)
  }

  return result
}
