import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany } from '@/lib/shared/db'
import { ENRICH_LOG_SELECT, promoteEnrichment, reEmbedProduct, type EnrichmentLogRow } from '@/lib/catalog/enrichment'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = (await req.json()) as { ids?: string[]; action?: string }
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []
  const action = body.action === 'reject' ? 'reject' : 'approve'

  if (ids.length === 0) return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: 'Max 200 per bulk operation' }, { status: 400 })

  const rows = await queryMany<EnrichmentLogRow>(
    `SELECT ${ENRICH_LOG_SELECT}
       FROM product_ai_enrichment_log
      WHERE id = ANY($1::uuid[]) AND status = 'proposed'`,
    [ids]
  )

  if (rows.length === 0) return NextResponse.json({ processed: 0 })

  if (action === 'reject') {
    await query(
      `UPDATE product_ai_enrichment_log
          SET status = 'rejected', decided_at = NOW(), decided_by_admin_id = $1::uuid
        WHERE id = ANY($2::uuid[]) AND status = 'proposed'`,
      [admin.adminId, ids]
    )
    return NextResponse.json({ processed: rows.length, action: 'rejected' })
  }

  await query(
    `UPDATE product_ai_enrichment_log
        SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = ANY($2::uuid[]) AND status = 'proposed'`,
    [admin.adminId, ids]
  )

  for (const row of rows) await promoteEnrichment(row)

  let embedded = 0
  await Promise.all(
    rows.map(async row => {
      const ok = (await reEmbedProduct(row.product_id)).ok
      await query(
        `UPDATE product_ai_enrichment_log
          SET promoted_at = NOW(),
              re_embedded_at = CASE WHEN $1 THEN NOW() ELSE re_embedded_at END
        WHERE id = $2::uuid`,
        [ok, row.id]
      )
      if (ok) embedded++
    })
  )

  return NextResponse.json({ processed: rows.length, embedded, action: 'approved' })
}
