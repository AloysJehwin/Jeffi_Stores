export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import {
  ENTITY_AI_FIELDS, entitiesNeedingEnrichment, entityEnrichmentContext, proposeEntityEnrichment, specFor, type EnrichEntity,
} from '@/lib/catalog/entity-enrichment'

export const dynamic = 'force-dynamic'

const isType = (t: unknown): t is EnrichEntity => t === 'brand' || t === 'category'

/** Brand / category proposals with the entity's current value for each proposed field. */
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const status = url.searchParams.get('status') || 'proposed'
  const rows = await queryMany<any>(
    `SELECT l.id::text, l.entity_type, l.entity_id::text, l.fields, l.faqs, l.sources, l.model, l.status, l.error,
            l.proposed_at, COALESCE(b.name, c.name) AS entity_name, COALESCE(b.slug, c.slug) AS entity_slug,
            CASE WHEN l.entity_type = 'brand' THEN to_jsonb(b) ELSE to_jsonb(c) END AS current
       FROM entity_ai_enrichment_log l
       LEFT JOIN brands b ON l.entity_type = 'brand' AND b.id = l.entity_id
       LEFT JOIN categories c ON l.entity_type = 'category' AND c.id = l.entity_id
      WHERE ($1::text IS NULL OR l.entity_type = $1) AND ($2 = 'all' OR l.status = $2)
      ORDER BY l.proposed_at DESC
      LIMIT 200`,
    [isType(type) ? type : null, status]
  )
  const proposals = rows.map(r => ({
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityName: r.entity_name,
    entitySlug: r.entity_slug,
    status: r.status,
    error: r.error,
    model: r.model,
    proposedAt: r.proposed_at,
    faqs: r.faqs ?? [],
    fields: Object.entries(r.fields ?? {}).map(([key, value]) => ({
      key,
      label: specFor(r.entity_type, key)?.label ?? key,
      role: ENTITY_AI_FIELDS[r.entity_type as EnrichEntity][key] ?? 'suggest',
      value,
      current: r.current?.[key] ?? null,
      source: r.sources?.[key] ?? null,
    })),
  }))
  return NextResponse.json({ proposals })
}

/** Queues proposals for the given ids, or for every brand / category with empty AI fields. */
export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  if (!isType(body.type)) return NextResponse.json({ error: 'type must be brand or category' }, { status: 400 })
  const type: EnrichEntity = body.type
  const ids: string[] = Array.isArray(body.ids) && body.ids.length ? body.ids.slice(0, 200) : await entitiesNeedingEnrichment(type, 200)
  if (!ids.length) return NextResponse.json({ queued: 0, message: `No ${type === 'brand' ? 'brands' : 'categories'} need enrichment` })

  // Runs after the response, a few seconds apart to stay inside the AI rate limits; tenant and store
  // name are resolved now, while the request context exists.
  const ctx = await entityEnrichmentContext()
  const RATE_MS = 6_000
  ;(async () => {
    for (const [i, id] of ids.entries()) {
      try {
        if (i) await new Promise(r => setTimeout(r, RATE_MS))
        await proposeEntityEnrichment(type, id, ctx)
      } catch (err) {
        console.error('[entity-enrichment] propose failed', type, id, err)
      }
    }
  })()

  return NextResponse.json({
    queued: ids.length,
    message: `Enriching ${ids.length} ${type === 'brand' ? 'brands' : 'categories'}; proposals appear over the next ${Math.ceil((ids.length * RATE_MS) / 60_000)} min`,
  })
}
