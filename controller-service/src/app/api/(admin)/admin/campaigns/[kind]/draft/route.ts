import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'
interface Params {
  params: Promise<{ kind: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const row = await queryOne<{ fields: Record<string, unknown> | null }>(
    `SELECT fields FROM campaign_drafts WHERE kind = $1`,
    [kind]
  )
  return NextResponse.json({ draft_fields: row?.fields ?? null })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const body = await req.json()
  await query(
    `INSERT INTO campaign_drafts (kind, fields, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (kind) DO UPDATE SET fields = EXCLUDED.fields, updated_at = now()`,
    [kind, JSON.stringify(body)]
  )
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  // Discard = clear the draft (keep the row so campaign_id stays stable for sessions).
  await query(
    `UPDATE campaign_drafts SET fields = '{}'::jsonb, updated_at = now() WHERE kind = $1`,
    [kind]
  )
  return NextResponse.json({ success: true })
}
