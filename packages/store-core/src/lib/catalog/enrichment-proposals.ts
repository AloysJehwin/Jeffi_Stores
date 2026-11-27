import { queryMany, queryOne } from '@/lib/shared/db'

// AI enrichment proposals for review (GET /api/admin/catalog-enrichment) and their export.

export interface EnrichmentProposal {
  id: string
  product_id: string
  product_name: string
  product_slug: string
  source_desc: string | null
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[] | null
  ai_who_uses_it: string | null
  ai_application: string | null
  ai_product_type: string | null
  ai_features: string[] | null
  ai_search_tags: string[] | null
  short_description: string | null
  usage_instructions: string | null
  care_instructions: string | null
  safety_warnings: string | null
  meta_title: string | null
  meta_description: string | null
  faqs: { question: string; answer: string }[] | null
  model: string
  status: string
  proposed_at: string
  promoted_at: string | null
  error: string | null
}

export async function listEnrichmentProposals(status: string, pageSize: number, page: number) {
  const offset = (page - 1) * pageSize
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM product_ai_enrichment_log l
       JOIN products p ON p.id = l.product_id
      WHERE ($1 = 'all' OR l.status = $1)`,
    [status]
  )
  const total = parseInt(countRow?.total || '0', 10)

  const rows = await queryMany<EnrichmentProposal>(
    `SELECT l.id::text, l.product_id::text,
            p.name AS product_name, p.slug AS product_slug,
            l.source_desc, l.ai_description, l.ai_use_cases,
            l.ai_keywords, l.ai_who_uses_it, l.ai_application,
            l.ai_product_type, l.ai_features, l.ai_search_tags,
            l.short_description, l.usage_instructions, l.care_instructions, l.safety_warnings,
            l.meta_title, l.meta_description, l.faqs,
            l.model, l.status, l.proposed_at, l.promoted_at, l.error
       FROM product_ai_enrichment_log l
       JOIN products p ON p.id = l.product_id
      WHERE ($1 = 'all' OR l.status = $1)
      ORDER BY l.proposed_at DESC
      LIMIT $2 OFFSET $3`,
    [status, pageSize, offset]
  )
  return { items: rows, total }
}
