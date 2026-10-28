import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { actorOf, draftLockResponse, withDraftCreate, withDraftWrite } from '@/lib/admin/draft-locks'
import { clearReplyDraft } from '@/lib/admin/rfq-reply-drafts'

export const dynamic = 'force-dynamic'

// The signed-in admin's unsent reply on this RFQ: GET it, PUT { message, counter_prices, show_counter }, DELETE it.

type Ctx = { params: Promise<{ id: string }> }
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_rfqs:read')
  if (admin instanceof NextResponse) return admin
  if (!isUuid(id)) return NextResponse.json({ draft: null })
  const draft = await queryOne(
    `SELECT id, message, counter_prices, show_counter, updated_at FROM rfq_reply_drafts WHERE rfq_id = $1 AND admin_id = $2`,
    [id, admin.adminId]
  )
  return NextResponse.json({ draft })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_rfqs:write')
  if (admin instanceof NextResponse) return admin
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message.slice(0, 5000) : ''
  const prices: Record<string, string> = {}
  if (body.counter_prices && typeof body.counter_prices === 'object' && !Array.isArray(body.counter_prices)) {
    for (const [k, v] of Object.entries(body.counter_prices).slice(0, 500)) {
      if (isUuid(k) && (typeof v === 'string' || typeof v === 'number')) prices[k] = String(v).slice(0, 20)
    }
  }
  const showCounter = body.show_counter === true
  const rfq = await queryOne(`SELECT 1 FROM business_rfqs WHERE id = $1`, [id])
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actor = actorOf(admin)
  const existing = await queryOne<{ id: string }>(`SELECT id FROM rfq_reply_drafts WHERE rfq_id = $1 AND admin_id = $2`, [id, admin.adminId])
  const vals = [message, JSON.stringify(prices), showCounter]
  try {
    if (existing) {
      await withDraftWrite(actor, 'rfq_reply', existing.id, db =>
        db.query(
          `UPDATE rfq_reply_drafts SET message = $1, counter_prices = $2::jsonb, show_counter = $3, updated_at = now() WHERE id = $4`,
          [...vals, existing.id]
        )
      )
      return NextResponse.json({ id: existing.id })
    }
    const draftId = randomUUID()
    await withDraftCreate(actor, 'rfq_reply', draftId, db =>
      db.query(
        `INSERT INTO rfq_reply_drafts (id, rfq_id, admin_id, message, counter_prices, show_counter) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [draftId, id, admin.adminId, ...vals]
      )
    )
    return NextResponse.json({ id: draftId }, { status: 201 })
  } catch (err) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    throw err
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_rfqs:write')
  if (admin instanceof NextResponse) return admin
  if (!isUuid(id)) return NextResponse.json({ ok: true })
  await withTransaction(c => clearReplyDraft(c, admin, id, 'discarded'))
  return NextResponse.json({ ok: true })
}
