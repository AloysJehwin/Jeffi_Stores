import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { productId: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const row = await queryOne<{
    id: string
    product_id: string
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
    error: string | null
  }>(
    `SELECT id::text, product_id::text, source_desc,
            ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
            ai_application, ai_product_type, ai_features, ai_search_tags,
            model, status, proposed_at, error
       FROM product_ai_enrichment_log
      WHERE product_id = $1::uuid
      ORDER BY proposed_at DESC
      LIMIT 1`,
    [params.productId]
  )

  if (!row) return NextResponse.json({ item: null })
  return NextResponse.json({ item: row })
}
