import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

function buildQuoteNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `QT/${fy}/${mon}/${seq}`
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  const rfq = await queryOne<any>(
    `SELECT r.*, u.first_name, u.last_name, u.email, u.phone, bp.company_name, bp.gst_number, bp.business_address
     FROM business_rfqs r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
     WHERE r.id = $1`,
    [params.id]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rfq.converted_quotation_id) return NextResponse.json({ error: 'Already converted' }, { status: 409 })

  const items = await queryMany<any>(
    `SELECT * FROM business_rfq_items WHERE rfq_id = $1 ORDER BY position, created_at`,
    [params.id]
  )
  if (items.length === 0) return NextResponse.json({ error: 'RFQ has no items' }, { status: 400 })

  // Build quote number
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  const prefix = `QT/${fy}/${mon}/`
  const maxRow = await queryOne<{ max_seq: string | null }>(
    `SELECT MAX(CAST(split_part(quote_number, '/', 4) AS INTEGER)) AS max_seq FROM quotations WHERE quote_number LIKE $1`,
    [prefix + '%']
  )
  const seq = (parseInt(maxRow?.max_seq || '0') || 0) + 1
  const quoteNumber = buildQuoteNumber(now, seq)

  const qt = await queryOne<any>(
    `INSERT INTO quotations (
      quote_number, quote_date, status,
      consignee_name, consignee_email, consignee_phone,
      buyer_same, notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
    ) VALUES ($1,$2,'draft',$3,$4,$5,true,$6,0,0,0,0,$7)
    RETURNING *`,
    [
      quoteNumber,
      now.toISOString().slice(0, 10),
      rfq.company_name || `${rfq.first_name} ${rfq.last_name}`.trim(),
      rfq.email,
      rfq.phone || null,
      rfq.notes || `Converted from RFQ ${rfq.rfq_number}`,
      admin.adminId,
    ]
  )

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    await query(
      `INSERT INTO quotation_items (quotation_id, position, description, quantity, unit, rate, gst_rate, discount_pct, amount, product_id, variant_id)
       VALUES ($1,$2,$3,$4,$5,0,18,0,0,$6,$7)`,
      [qt!.id, idx, item.description, item.quantity, item.unit, item.product_id || null, item.variant_id || null]
    )
  }

  await query(
    `UPDATE business_rfqs SET status='converted', converted_quotation_id=$1, updated_at=NOW() WHERE id=$2`,
    [qt!.id, params.id]
  )

  return NextResponse.json({ quotationId: qt!.id, quoteNumber: qt!.quote_number })
}
