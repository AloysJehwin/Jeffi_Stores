import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ kind: string }>
}

// GET — return draft_fields for this campaign
export async function GET(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const row = await queryOne<{ draft_fields: Record<string, unknown> | null }>(
    `SELECT draft_fields FROM campaigns WHERE kind = $1`,
    [kind]
  )
  if (!row) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  return NextResponse.json({ draft_fields: row.draft_fields })
}

// PATCH — save to draft_fields (does not touch live campaign)
export async function PATCH(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await req.json()
  await query(`UPDATE campaigns SET draft_fields = $2::jsonb, updated_at = NOW() WHERE kind = $1`, [
    kind,
    JSON.stringify(body),
  ])
  return NextResponse.json({ success: true })
}

// DELETE — discard draft
export async function DELETE(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  await query(`UPDATE campaigns SET draft_fields = NULL, updated_at = NOW() WHERE kind = $1`, [kind])
  return NextResponse.json({ success: true })
}
