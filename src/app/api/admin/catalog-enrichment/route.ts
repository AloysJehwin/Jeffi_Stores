import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent') && !hasScope(admin.role, admin.scopes, 'products')) {
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
    model: string
    status: string
    proposed_at: string
    promoted_at: string | null
    error: string | null
  }>(
    `SELECT l.id::text, l.product_id::text,
            p.name AS product_name, p.slug AS product_slug,
            l.source_desc, l.ai_description, l.ai_use_cases,
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
