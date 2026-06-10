import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT r.id, r.rfq_number, r.status, r.notes, r.admin_note, r.created_at, r.converted_quotation_id,
            q.view_token AS quotation_view_token, q.quote_number, q.converted_order_id
     FROM business_rfqs r
     LEFT JOIN quotations q ON q.id = r.converted_quotation_id
     WHERE r.id = $1 AND r.user_id = $2`,
    [params.id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = await queryMany<any>(
    `SELECT id, description, quantity, unit, requested_price, notes
     FROM business_rfq_items WHERE rfq_id = $1 ORDER BY position, created_at`,
    [params.id]
  )

  let order: any = null
  if (rfq.converted_order_id) {
    order = await queryOne<any>(
      `SELECT id, order_number, payment_status, payment_mode, razorpay_qr_image_url, total_amount, invoice_number, status
       FROM orders WHERE id = $1`,
      [rfq.converted_order_id]
    )
  }

  return NextResponse.json({ rfq, items, order: order || null })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [params.id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['pending', 'reviewed'].includes(rfq.status)) {
    return NextResponse.json({ error: 'Cannot edit this quote' }, { status: 400 })
  }

  const { notes, items } = await request.json()

  if (notes !== undefined) {
    await query(`UPDATE business_rfqs SET notes = $1 WHERE id = $2`, [notes || null, params.id])
  }

  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item.id) continue
      await query(
        `UPDATE business_rfq_items
         SET quantity = COALESCE($1, quantity),
             requested_price = $2,
             notes = $3
         WHERE id = $4 AND rfq_id = $5`,
        [
          item.quantity != null ? Number(item.quantity) : null,
          item.requested_price != null ? Number(item.requested_price) : null,
          item.notes ?? null,
          item.id,
          params.id,
        ]
      )
    }
  }

  return NextResponse.json({ ok: true })
}

