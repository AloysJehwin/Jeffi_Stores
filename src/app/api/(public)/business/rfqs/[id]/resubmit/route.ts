import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { queryMany, query, queryOne } from '@/lib/shared/db'
import { sendRfqSubmittedEmail } from '@/lib/shared/email-business'

function buildRfqNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `RFQ/${fy}/${mon}/${seq}`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.approvalStatus !== 'approved')
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 })

  const source = await queryOne<any>(
    `SELECT id, rfq_number, status, notes FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [id, user.userId]
  )
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (source.status !== 'rejected') {
    return NextResponse.json({ error: 'Only rejected RFQs can be resubmitted' }, { status: 400 })
  }

  const sourceItems = await queryMany<any>(
    `SELECT product_id, variant_id, sub_variant_id, description, quantity, unit, requested_price, notes, position
     FROM business_rfq_items WHERE rfq_id = $1 ORDER BY position`,
    [id]
  )
  if (sourceItems.length === 0) {
    return NextResponse.json({ error: 'Source RFQ has no items' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const additionalNotes: string | undefined = body?.notes?.trim() || undefined

  const baseNote = `Resubmitted from ${source.rfq_number}`
  const combinedNotes = additionalNotes
    ? `${baseNote}\n\n${additionalNotes}`
    : source.notes
      ? `${baseNote}\n\n${source.notes}`
      : baseNote

  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  const prefix = `RFQ/${fy}/${mon}/`

  const maxRow = await queryOne<{ max_seq: string | null }>(
    `SELECT MAX(CAST(split_part(rfq_number, '/', 4) AS INTEGER)) AS max_seq FROM business_rfqs WHERE rfq_number LIKE $1`,
    [prefix + '%']
  )
  const seq = (parseInt(maxRow?.max_seq || '0') || 0) + 1
  const rfqNumber = buildRfqNumber(now, seq)

  const newRfq = await queryOne<any>(
    `INSERT INTO business_rfqs (rfq_number, user_id, notes) VALUES ($1,$2,$3) RETURNING *`,
    [rfqNumber, user.userId, combinedNotes]
  )

  for (let idx = 0; idx < sourceItems.length; idx++) {
    const it = sourceItems[idx]
    await query(
      `INSERT INTO business_rfq_items (rfq_id, product_id, variant_id, sub_variant_id, description, quantity, unit, requested_price, notes, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        newRfq!.id,
        it.product_id,
        it.variant_id,
        it.sub_variant_id,
        it.description,
        it.quantity,
        it.unit,
        it.requested_price,
        it.notes,
        idx,
      ]
    )
  }

  const userProfile = await queryOne<{ first_name: string | null; last_name: string | null }>(
    'SELECT first_name, last_name FROM users WHERE id = $1',
    [user.userId]
  )
  const displayName = [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(' ') || user.email

  sendRfqSubmittedEmail(user.email, displayName, newRfq!.rfq_number).catch(() => {})

  return NextResponse.json({ rfq: newRfq }, { status: 201 })
}
