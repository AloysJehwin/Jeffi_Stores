import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryMany, queryCount, query, queryOne } from '@/lib/db'
import { sendRfqSubmittedEmail } from '@/lib/email-business'
import { createAdminNotification } from '@/lib/admin-notify'

function buildRfqNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `RFQ/${fy}/${mon}/${seq}`
}

export async function GET(request: NextRequest) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.approvalStatus !== 'approved')
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const PAGE_SIZE = 20
  const offset = (page - 1) * PAGE_SIZE

  const [rfqs, total] = await Promise.all([
    queryMany<any>(
      `SELECT r.id, r.rfq_number, r.status, r.notes, r.converted_quotation_id, r.created_at,
              (SELECT COUNT(*) FROM business_rfq_items ri WHERE ri.rfq_id = r.id)::int AS item_count,
              (SELECT SUM(ri.quantity * ri.requested_price) FROM business_rfq_items ri WHERE ri.rfq_id = r.id AND ri.requested_price IS NOT NULL) AS requested_total,
              q.quote_number, q.view_token AS quotation_view_token, q.total_amount AS quotation_total,
              ord.id AS order_id, ord.view_token AS invoice_view_token, ord.invoice_number, ord.payment_status, ord.status AS order_status,
              ord.total_amount AS invoice_total
       FROM business_rfqs r
       LEFT JOIN quotations q ON q.id = r.converted_quotation_id
       LEFT JOIN orders ord ON ord.id = q.converted_order_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [user.userId, PAGE_SIZE, offset]
    ),
    queryCount('SELECT COUNT(*) FROM business_rfqs WHERE user_id=$1', [user.userId]),
  ])

  return NextResponse.json({ rfqs, total, page, pageSize: PAGE_SIZE })
}

export async function POST(request: NextRequest) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.approvalStatus !== 'approved')
    return NextResponse.json({ error: 'Account pending approval' }, { status: 403 })

  const { notes, items } = await request.json()
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }

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

  const rfq = await queryOne<any>(
    `INSERT INTO business_rfqs (rfq_number, user_id, notes) VALUES ($1,$2,$3) RETURNING *`,
    [rfqNumber, user.userId, notes || null]
  )

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    await query(
      `INSERT INTO business_rfq_items (rfq_id, product_id, variant_id, sub_variant_id, description, quantity, unit, requested_price, notes, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        rfq!.id,
        item.productId || null,
        item.variantId || null,
        item.subVariantId || null,
        item.description || '',
        item.quantity || 1,
        item.unit || 'Nos',
        item.requested_price ?? null,
        item.notes || null,
        idx,
      ]
    )
  }

  const userProfile = await queryOne<{ first_name: string | null; last_name: string | null }>(
    'SELECT first_name, last_name FROM users WHERE id = $1',
    [user.userId]
  )
  const displayName = [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(' ') || user.email

  sendRfqSubmittedEmail(user.email, displayName, rfq!.rfq_number).catch(() => {})

  createAdminNotification({
    type: 'rfq_submitted',
    category: 'b2b',
    title: `New RFQ ${rfq!.rfq_number}`,
    message: `From ${displayName} — ${items.length} item(s)`,
    link: `/admin/business/rfqs/${rfq!.id}`,
    entityType: 'rfq',
    entityId: String(rfq!.id),
    scope: 'business_rfqs:read',
  }).catch(() => {})

  return NextResponse.json({ rfq }, { status: 201 })
}
