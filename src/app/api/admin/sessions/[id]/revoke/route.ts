import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { revokeSession } from '@/lib/auth/auth-sessions'
import { queryOne } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Params {
  params: Promise<{ id: string }>
}

// Revoke one of the logged-in admin's own sessions. Ownership-checked: the target
// row's principal must match the authenticated admin.
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ principal_type: string; principal_id: string }>(
    `SELECT principal_type, principal_id FROM auth_sessions WHERE id = $1`,
    [id]
  )
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (row.principal_type !== 'admin' || row.principal_id !== admin.adminId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await revokeSession(id)
  return NextResponse.json({ success: true })
}
