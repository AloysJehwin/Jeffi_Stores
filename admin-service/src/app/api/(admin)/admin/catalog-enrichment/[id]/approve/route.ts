import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { ENRICH_LOG_SELECT, promoteEnrichment, reEmbedProduct, type EnrichmentLogRow } from '@/lib/catalog/enrichment'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const row = await queryOne<EnrichmentLogRow & { status: string }>(
    `SELECT ${ENRICH_LOG_SELECT}, status FROM product_ai_enrichment_log WHERE id = $1::uuid`,
    [id]
  )
  if (!row) return NextResponse.json({ error: 'Enrichment not found' }, { status: 404 })
  if (row.status !== 'proposed') {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 400 })
  }

  await query(
    `UPDATE product_ai_enrichment_log
        SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = $2::uuid`,
    [admin.adminId, id]
  )

  await promoteEnrichment(row)

  const embedResult = await reEmbedProduct(row.product_id)

  await query(
    `UPDATE product_ai_enrichment_log
        SET promoted_at = NOW(),
            re_embedded_at = CASE WHEN $1 THEN NOW() ELSE re_embedded_at END,
            error = $2
      WHERE id = $3::uuid`,
    [embedResult.ok, embedResult.ok ? null : embedResult.error || null, id]
  )

  return NextResponse.json({
    ok: true,
    promoted: true,
    reEmbedded: embedResult.ok,
    embedError: embedResult.ok ? null : embedResult.error,
  })
}
