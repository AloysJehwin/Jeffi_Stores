import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = (url.searchParams.get('status') || 'proposed').toLowerCase()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)

  const rows = await queryMany<{
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
    model: string
    status: string
    proposed_at: string
    promoted_at: string | null
    error: string | null
  }>(
    `SELECT l.id::text, l.product_id::text,
            p.name AS product_name, p.slug AS product_slug,
            l.source_desc, l.ai_description, l.ai_use_cases,
            l.ai_keywords, l.ai_who_uses_it, l.ai_application,
            l.ai_product_type, l.ai_features, l.ai_search_tags,
            l.model, l.status, l.proposed_at, l.promoted_at, l.error
       FROM product_ai_enrichment_log l
       JOIN products p ON p.id = l.product_id
      WHERE ($1 = 'all' OR l.status = $1)
      ORDER BY l.proposed_at DESC
      LIMIT $2`,
    [status, limit]
  )

  return NextResponse.json({ items: rows })
}
