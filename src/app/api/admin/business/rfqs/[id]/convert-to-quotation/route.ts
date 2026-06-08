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

// Parse "Address Line, City, State, Pincode" into parts
function parseAddress(raw: string | null): { addr1: string; addr2: string | null; city: string; state: string; pincode: string | null } {
  if (!raw) return { addr1: '', addr2: null, city: '', state: 'Chhattisgarh', pincode: null }
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
  // Last part may be pincode (6 digits), second-last is state, third-last is city
  let pincode: string | null = null
  if (parts.length > 0 && /^\d{6}$/.test(parts[parts.length - 1])) {
    pincode = parts.pop()!
  }
  const state = parts.pop() || 'Chhattisgarh'
  const city = parts.pop() || ''
  const addr1 = parts[0] || ''
  const addr2 = parts.slice(1).join(', ') || null
  return { addr1, addr2, city, state, pincode }
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
    `SELECT ri.*,
       p.name AS product_name, p.price_ex_gst AS product_price, p.mrp AS product_mrp,
       p.gst_percentage AS product_gst, p.hsn_code AS product_hsn,
       pv.variant_name, pv.price_ex_gst AS variant_price, pv.mrp AS variant_mrp, pv.sku AS variant_sku,
       psv.sub_variant_name, psv.price_ex_gst AS sv_price, psv.mrp AS sv_mrp, psv.sku AS sv_sku
     FROM business_rfq_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     LEFT JOIN product_variants pv ON pv.id = ri.variant_id
     LEFT JOIN product_sub_variants psv ON psv.id = ri.sub_variant_id
     WHERE ri.rfq_id = $1
     ORDER BY ri.position, ri.created_at`,
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

  // Parse business address
  const addr = parseAddress(rfq.business_address)
  const consigneeName = rfq.company_name || `${rfq.first_name} ${rfq.last_name}`.trim()

  // Calculate line totals for subtotal/tax
  let subtotal = 0
  let cgst = 0
  let sgst = 0

  const lineItems = items.map((item: any) => {
    // Pick best available price: requested_price > sub_variant > variant > product
    const baseRate = item.requested_price
      ? Number(item.requested_price)
      : item.sv_price
        ? Number(item.sv_price)
        : item.variant_price
          ? Number(item.variant_price)
          : item.product_price
            ? Number(item.product_price)
            : 0

    const gstRate = Number(item.product_gst ?? 18)
    const discountPct = 0
    const qty = Number(item.quantity)
    const amount = baseRate * qty * (1 - discountPct / 100)
    const taxableAmount = amount
    const itemCgst = taxableAmount * (gstRate / 2) / 100
    const itemSgst = taxableAmount * (gstRate / 2) / 100

    subtotal += amount
    cgst += itemCgst
    sgst += itemSgst

    // Build description: use product/variant names if available, else the free-text description
    let description = item.description
    if (item.product_name && item.product_name !== item.description) {
      description = item.product_name
      if (item.variant_name) description += ` — ${item.variant_name}`
      if (item.sub_variant_name) description += ` / ${item.sub_variant_name}`
    }

    return {
      description,
      hsn_code: item.product_hsn || null,
      gst_rate: gstRate,
      quantity: qty,
      unit: item.unit || 'Nos',
      rate: baseRate,
      discount_pct: discountPct,
      amount,
      product_id: item.product_id || null,
      variant_id: item.variant_id || null,
      sub_variant_id: item.sub_variant_id || null,
    }
  })

  const total = subtotal + cgst + sgst

  const qt = await queryOne<any>(
    `INSERT INTO quotations (
      quote_number, quote_date, status,
      consignee_name, consignee_addr1, consignee_addr2, consignee_city, consignee_state,
      consignee_pincode, consignee_gstin, consignee_email, consignee_phone,
      buyer_same,
      buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state, buyer_pincode, buyer_gstin, buyer_email, buyer_phone,
      notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
    ) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,true,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$12,$13,$14,$15,$16,$17)
    RETURNING *`,
    [
      quoteNumber,
      now.toISOString().slice(0, 10),
      consigneeName,
      addr.addr1,
      addr.addr2,
      addr.city,
      addr.state,
      addr.pincode,
      rfq.gst_number || null,
      rfq.email,
      rfq.phone || null,
      rfq.notes ? `${rfq.notes}\n\nConverted from RFQ ${rfq.rfq_number}` : `Converted from RFQ ${rfq.rfq_number}`,
      subtotal.toFixed(4),
      cgst.toFixed(4),
      sgst.toFixed(4),
      total.toFixed(4),
      admin.adminId,
    ]
  )

  for (let idx = 0; idx < lineItems.length; idx++) {
    const li = lineItems[idx]
    await query(
      `INSERT INTO quotation_items
         (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, rate, discount_pct, amount, product_id, variant_id, sub_variant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [qt!.id, idx, li.description, li.hsn_code, li.gst_rate, li.quantity, li.unit, li.rate, li.discount_pct, li.amount, li.product_id, li.variant_id, li.sub_variant_id]
    )
  }

  await query(
    `UPDATE business_rfqs SET status='converted', converted_quotation_id=$1, updated_at=NOW() WHERE id=$2`,
    [qt!.id, params.id]
  )

  return NextResponse.json({ quotationId: qt!.id, quoteNumber: qt!.quote_number })
}
