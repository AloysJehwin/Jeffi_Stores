import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'service_accounts:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const sa = await queryOne(
    `SELECT id, name, common_name, allowed_scopes, is_revoked, revoked_at,
            p12_downloaded, created_at, last_used_at
     FROM service_accounts WHERE id = $1`,
    [id]
  )
  if (!sa) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(sa)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'service_accounts:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const existing = await queryOne<{ id: string; is_revoked: boolean }>(
    `SELECT id, is_revoked FROM service_accounts WHERE id = $1`,
    [id]
  )
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.is_revoked) return NextResponse.json({ error: 'Already revoked' }, { status: 409 })

  await query(
    `UPDATE service_accounts
     SET is_revoked = true, revoked_at = NOW(), p12_data = NULL, p12_password = NULL
     WHERE id = $1`,
    [id]
  )
  return NextResponse.json({ ok: true })
}
