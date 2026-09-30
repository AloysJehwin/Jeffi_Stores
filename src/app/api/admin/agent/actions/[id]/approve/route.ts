import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import type { AgentAction } from './_lib/shared'
import { executeAction } from './_lib/execute'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const action = await queryOne<AgentAction>(
    `SELECT id::text, admin_id::text, conversation_id::text, kind, payload, status
     FROM admin_agent_actions WHERE id = $1::uuid LIMIT 1`,
    [id]
  )
  if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  if (action.admin_id !== admin.adminId) return NextResponse.json({ error: 'Not your action' }, { status: 403 })
  if (action.status !== 'proposed') {
    return NextResponse.json({ error: `Action already ${action.status}` }, { status: 400 })
  }

  await query(
    `UPDATE admin_agent_actions SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1
     WHERE id = $2::uuid`,
    [admin.adminId, id]
  )

  const cookieHeader = req.headers.get('cookie') || ''
  const { result, error } = await executeAction(action, cookieHeader)

  await query(
    `UPDATE admin_agent_actions
     SET status = $1, executed_at = NOW(), result = $2::jsonb, error = $3
     WHERE id = $4::uuid`,
    [error ? 'failed' : 'executed', JSON.stringify(result || {}), error, id]
  )

  if (error) return NextResponse.json({ ok: false, error, status: 'failed' }, { status: 500 })
  return NextResponse.json({ ok: true, result, status: 'executed' })
}
