import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import {
  actorOf,
  campaignLockId,
  draftLockResponse,
  epochFrom,
  withDraftWrite,
} from '@/lib/admin/draft-locks'
import { discardCampaignDraft, discardReply } from '@/lib/admin/discard-rows'

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
  const actor = actorOf(admin)
  try {
    const lockId = actor ? await campaignLockId(kind, true) : null
    await withDraftWrite(
      actor,
      'campaign',
      lockId ?? '',
      db =>
        db.query(
          `INSERT INTO campaign_drafts (kind, fields, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (kind) DO UPDATE SET fields = EXCLUDED.fields, updated_at = now()`,
          [kind, JSON.stringify(body)]
        ),
      { epoch: epochFrom(req), ensure: true }
    )
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { kind } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return discardReply(await discardCampaignDraft(actorOf(admin), kind))
}
