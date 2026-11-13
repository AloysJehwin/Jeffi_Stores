export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { aiChat } from '@/lib/shared/ai-client'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import {
  ENRICH_JOINS, ENRICH_SELECT, buildEnrichmentPrompt, enrichmentSystemPrompt, insertEnrichmentProposal, parseEnrichment,
  type EnrichSource,
} from '@/lib/catalog/enrichment'

export const dynamic = 'force-dynamic'

const BATCH_LIMIT = 200
const RESTAGE_DAYS = 90

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Resolve the tenant's descriptor inside the request: the loop below outlives the response.
  const SYSTEM_PROMPT = enrichmentSystemPrompt(await storeDescriptorForPrompt())
  const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
  const cacheNamespace = (await resolveTenantId()) ?? 'platform'

  const candidates = await queryMany<EnrichSource & { has_faqs?: boolean }>(
    `SELECT ${ENRICH_SELECT},
            EXISTS (SELECT 1 FROM product_faqs f WHERE f.product_id = p.id) AS has_faqs
       FROM products p
       ${ENRICH_JOINS}
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

        const r = await aiChat({
          feature: 'enrichment',
          cacheNamespace,
          modelHint: 'copy',
          jsonMode: true,
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildEnrichmentPrompt(p, !!p.has_faqs) },
          ],
        })
        const e = parseEnrichment(r.content)

        await insertEnrichmentProposal(p, e, r.model)
      } catch {
        void 0
      }
    }
  })()

  return NextResponse.json({
    queued: candidates.length,
    message: `Enriching ${candidates.length} products at 5/min — check back in ${Math.ceil(candidates.length / 5)} minutes`,
  })
}
