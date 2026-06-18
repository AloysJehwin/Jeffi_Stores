import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT r.id, r.rfq_number, r.status, r.notes, r.admin_note, r.created_at, r.converted_quotation_id,
            q.view_token AS quotation_view_token, q.quote_number, q.converted_order_id
     FROM business_rfqs r
     LEFT JOIN quotations q ON q.id = r.converted_quotation_id
     WHERE r.id = $1 AND r.user_id = $2`,
    [id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const items = await queryMany<any>(
    `SELECT ri.id, ri.description, ri.quantity, ri.unit, ri.requested_price, ri.notes,
            ri.product_id, ri.variant_id,
            p.slug AS product_slug,
            p.category_id,
            p.base_price AS catalog_price,
            p.mrp AS catalog_mrp,
            pv.price AS variant_price,
            pv.mrp AS variant_mrp,
            pv.sku AS variant_sku,
            (SELECT pi.image_url FROM product_images pi
             WHERE pi.product_id = p.id
             ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url,
            qi.rate AS quoted_rate,
            qi.discount_pct AS quoted_discount_pct,
            qi.gst_rate AS quoted_gst_rate
     FROM business_rfq_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     LEFT JOIN product_variants pv ON pv.id = ri.variant_id
     LEFT JOIN quotation_items qi
       ON qi.quotation_id = $2
      AND qi.product_id = ri.product_id
      AND (qi.variant_id = ri.variant_id OR (qi.variant_id IS NULL AND ri.variant_id IS NULL))
     WHERE ri.rfq_id = $1 ORDER BY ri.position, ri.created_at`,
    [id, rfq.converted_quotation_id]
  )

  const discountRows = await queryMany<{ category_id: string; discount_pct: string }>(
    `SELECT category_id, discount_pct FROM business_discounts WHERE user_id = $1`,
    [user.userId]
  )
  const discountMap: Record<string, number> = {}
  for (const row of discountRows) {
    discountMap[row.category_id] = Number(row.discount_pct)
  }

  let order: any = null
  if (rfq.converted_order_id) {
    order = await queryOne<any>(
      `SELECT id, order_number, payment_status, payment_mode, razorpay_qr_image_url, total_amount, invoice_number, status, view_token
       FROM orders WHERE id = $1 AND status != 'draft'`,
      [rfq.converted_order_id]
    )
  }

  return NextResponse.json({ rfq, items, order: order || null, discountMap })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rfq = await queryOne<any>(
    `SELECT id, status FROM business_rfqs WHERE id = $1 AND user_id = $2`,
    [id, user.userId]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['pending', 'reviewed', 'negotiating'].includes(rfq.status)) {
    return NextResponse.json({ error: 'Cannot edit this quote' }, { status: 400 })
  }

  const { notes, items } = await request.json()

  if (notes !== undefined) {
    await query(`UPDATE business_rfqs SET notes = $1 WHERE id = $2`, [notes || null, id])
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
          id,
        ]
      )
    }
  }

  return NextResponse.json({ ok: true })
}

