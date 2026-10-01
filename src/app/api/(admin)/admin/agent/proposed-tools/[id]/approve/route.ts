import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!isPlatformOwner(admin.role)) {
    return NextResponse.json({ error: 'Only platform owners can approve dynamic tools' }, { status: 403 })
  }

  const row = await queryOne<{ id: string; name: string; status: string; proposed_by_admin_id: string }>(
    `SELECT id::text, name, status, proposed_by_admin_id::text FROM admin_agent_proposed_tools WHERE id = $1::uuid`,
    [id]
  )
  if (!row) return NextResponse.json({ error: 'Proposed tool not found' }, { status: 404 })
  if (row.status !== 'proposed') {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 400 })
  }
  if (row.proposed_by_admin_id === admin.adminId) {
    return NextResponse.json({ error: 'Cannot approve your own proposal — separation of duties' }, { status: 403 })
  }

  await query(
    `UPDATE admin_agent_proposed_tools
        SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = $2::uuid`,
    [admin.adminId, id]
  )
  return NextResponse.json({ ok: true, status: 'approved' })
}
