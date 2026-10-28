import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { actorOf, canDiscard, closeDraftLockTx, draftLockResponse, epochFrom, withDraftWrite } from '@/lib/admin/draft-locks'
import { parseScenarioDraft } from '@/lib/campaigns/scenario-drafts'

export const dynamic = 'force-dynamic'

const GONE = 'This scenario draft was already saved or discarded'
const uuidOk = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'campaigns:read')
  if (admin instanceof NextResponse) return admin
  const row = uuidOk(id) ? await queryOne(`SELECT id, title, fields, updated_at FROM scenario_drafts WHERE id = $1`, [id]) : null
  if (!row) return NextResponse.json({ error: GONE }, { status: 404 })
  return NextResponse.json({ draft: row })
}

// PATCH { title?, fields? } — autosave; the lock holder only (423 otherwise).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return admin
  if (!uuidOk(id)) return NextResponse.json({ error: GONE }, { status: 404 })
  const parsed = parseScenarioDraft(await request.json().catch(() => ({})))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  try {
    const r = await withDraftWrite(
      actorOf(admin),
      'scenario',
      id,
      db =>
        db.query(
          `UPDATE scenario_drafts SET
             title = CASE WHEN $2 THEN $3 ELSE title END,
             fields = COALESCE($4::jsonb, fields),
             updated_at = now()
           WHERE id = $1`,
          [id, parsed.title !== undefined, parsed.title ?? null, parsed.fields ? JSON.stringify(parsed.fields) : null]
        ),
      { epoch: epochFrom(request) }
    )
    if (!r.rowCount) return NextResponse.json({ error: GONE }, { status: 404 })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'campaigns:write')
  if (admin instanceof NextResponse) return admin
  if (!uuidOk(id)) return NextResponse.json({ ok: true })
  const actor = actorOf(admin)
  const allowed = await canDiscard(actor, 'scenario', id)
  if (!allowed.ok) return NextResponse.json(allowed.error.body(), { status: 423 })
  await withTransaction(async client => {
    const r = await client.query(`DELETE FROM scenario_drafts WHERE id = $1`, [id])
    if (r.rowCount) await closeDraftLockTx(client, actor, 'scenario', id, 'discarded')
  })
  return NextResponse.json({ ok: true })
}
