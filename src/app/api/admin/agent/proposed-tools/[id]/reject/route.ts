import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}) as { reason?: string })
  const reason = String((body as any).reason || '')
    .trim()
    .slice(0, 500)

  const row = await queryOne<{ status: string }>(`SELECT status FROM admin_agent_proposed_tools WHERE id = $1::uuid`, [
    id,
  ])
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'proposed') {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 400 })
  }

  await query(
    `UPDATE admin_agent_proposed_tools
        SET status = 'rejected', decided_at = NOW(),
            decided_by_admin_id = $1::uuid, rejection_reason = NULLIF($2, '')
      WHERE id = $3::uuid`,
    [admin.adminId, reason, id]
  )
  return NextResponse.json({ ok: true, status: 'rejected' })
}
