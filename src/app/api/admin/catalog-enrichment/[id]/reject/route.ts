import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const row = await queryOne<{ id: string; status: string }>(
    `SELECT id::text, status FROM product_ai_enrichment_log WHERE id = $1::uuid`,
    [params.id]
  )
  if (!row) return NextResponse.json({ error: 'Enrichment not found' }, { status: 404 })
  if (row.status !== 'proposed') {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 400 })
  }

  await query(
    `UPDATE product_ai_enrichment_log
        SET status = 'rejected', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = $2::uuid`,
    [admin.adminId, params.id]
  )
  return NextResponse.json({ ok: true, status: 'rejected' })
}
