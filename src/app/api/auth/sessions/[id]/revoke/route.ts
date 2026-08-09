import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { revokeSession } from '@/lib/auth-sessions'
import { queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Params { params: Promise<{ id: string }> }

// Revoke one of the caller's own sessions. Ownership-checked: the target row's
// principal must match the authenticated customer.
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const auth = await authenticateUser(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ principal_type: string; principal_id: string }>(
    `SELECT principal_type, principal_id FROM auth_sessions WHERE id = $1`,
    [id]
  )
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (row.principal_type !== 'customer' || row.principal_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await revokeSession(id)
  return NextResponse.json({ success: true })
}
