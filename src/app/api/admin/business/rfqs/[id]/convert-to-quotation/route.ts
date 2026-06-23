import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'
import { stackDiscounts, applyDiscount, lineItemExGst } from '@/lib/pricing'
import { sendRfqConvertedToQuotationEmail } from '@/lib/email-business'

function buildQuoteNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `QT/${fy}/${mon}/${seq}`
}

function parseAddress(raw: string | null): { addr1: string; addr2: string | null; city: string; state: string; pincode: string | null } {
  if (!raw) return { addr1: '', addr2: null, city: '', state: 'Chhattisgarh', pincode: null }
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminScope(request, 'business_rfqs')
  if (admin instanceof NextResponse) return admin

  const rfq = await queryOne<any>(
    `SELECT r.*, u.first_name, u.last_name, u.email, u.phone, bp.company_name, bp.gst_number, bp.business_address
     FROM business_rfqs r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
     WHERE r.id = $1`,
    [id]
  )
  if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rfq.converted_quotation_id) return NextResponse.json({ error: 'Already converted' }, { status: 409 })

  // Load per-category business discounts for this user
  const discountRows = await queryMany<{ category_id: string; discount_pct: string }>(
    `SELECT category_id, discount_pct FROM business_discounts WHERE user_id = $1`,
    [rfq.user_id]
  )
  const discountMap: Record<string, number> = {}
  for (const row of discountRows) {
    discountMap[row.category_id] = Number(row.discount_pct)
  }

  const items = await queryMany<any>(
    `SELECT ri.*,
       p.name AS product_name, p.price_ex_gst AS product_price, p.mrp AS product_mrp,
       p.gst_percentage AS product_gst, p.hsn_code AS product_hsn,
       p.category_id AS product_category_id,
       p.discount_pct AS product_discount_pct,
       pv.variant_name, pv.price_ex_gst AS variant_price, pv.mrp AS variant_mrp, pv.sku AS variant_sku,
       pv.discount_pct AS variant_discount_pct,
       psv.sub_variant_name, psv.price_ex_gst AS sv_price, psv.mrp AS sv_mrp, psv.sku AS sv_sku,
       psv.discount_pct AS sv_discount_pct,
       pu.factor AS unit_factor, pu.display_label AS unit_display_label
     FROM business_rfq_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     LEFT JOIN product_variants pv ON pv.id = ri.variant_id
     LEFT JOIN product_sub_variants psv ON psv.id = ri.sub_variant_id
     LEFT JOIN product_units pu ON pu.product_id = ri.product_id AND pu.unit = ri.unit
     WHERE ri.rfq_id = $1
     ORDER BY ri.position, ri.created_at`,
    [id]
  )
  if (items.length === 0) return NextResponse.json({ error: 'RFQ has no items' }, { status: 400 })

  // Pick the latest counter offer regardless of sender — when admin converts
  // to a quotation, they're accepting whatever is on the table (whether the
  // last word came from admin or customer). Falls back to requested_price.
  const acceptedOfferRow = await queryOne<{ counter_items: any }>(
    `SELECT counter_items FROM rfq_messages
     WHERE rfq_id = $1 AND counter_items IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [id]
  )
  // Map rfq_item_id → offered_price (incl-GST, same format as requested_price)
  const negotiatedPriceMap: Record<string, number> = {}
  if (acceptedOfferRow?.counter_items) {
    const ci = Array.isArray(acceptedOfferRow.counter_items)
      ? acceptedOfferRow.counter_items
      : JSON.parse(acceptedOfferRow.counter_items)
    for (const entry of ci) {
      if (entry.rfq_item_id && entry.offered_price != null) {
        negotiatedPriceMap[entry.rfq_item_id] = Number(entry.offered_price)
      }
    }
  }

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

  const addr = parseAddress(rfq.business_address)
  const consigneeName = rfq.company_name || `${rfq.first_name} ${rfq.last_name}`.trim()

  let subtotal = 0
  let cgst = 0
  let sgst = 0

  const lineItems = items.map((item: any) => {
    const gstRate = Number(item.product_gst ?? 18)

    let baseRateExGst: number
    let discountPct: number

    // MRP ex-GST — rate anchor for the quotation.
    // Some products (e.g. Unbrako) store ex-GST values in the MRP column.
    // Detect: if mrp == price_ex_gst for the same level, the column is already ex-GST.
    const rawMrp = item.sv_mrp
      ? Number(item.sv_mrp)
      : item.variant_mrp
        ? Number(item.variant_mrp)
        : item.product_mrp
          ? Number(item.product_mrp)
          : 0
    const rawPriceExGst = item.sv_price
      ? Number(item.sv_price)
      : item.variant_price
        ? Number(item.variant_price)
        : item.product_price
          ? Number(item.product_price)
          : 0
    // If mrp equals price_ex_gst (within 1 rupee), it's already ex-GST — use as-is
    const mrpIsAlreadyExGst = rawMrp > 0 && rawPriceExGst > 0 && Math.abs(rawMrp - rawPriceExGst) < 1
    // If the selling unit has a factor (e.g. box=50 pieces), the DB price is
    // per base unit — scale up so the rate shown on the quotation is per selling unit.
    const unitFactor = item.unit_factor != null ? Number(item.unit_factor) : 1
    baseRateExGst = rawMrp > 0
      ? (mrpIsAlreadyExGst ? rawMrp : rawMrp / (1 + gstRate / 100)) * unitFactor
      : 0

    // Business price ex-GST: product discount + B2B category discount stacked
    const productDisc = Number(item.sv_discount_pct ?? item.variant_discount_pct ?? item.product_discount_pct ?? 0)
    const b2bDisc = item.product_category_id ? (discountMap[item.product_category_id] ?? 0) : 0
    const businessDiscPct = stackDiscounts(productDisc, b2bDisc)
    const businessPriceExGst = baseRateExGst > 0 ? applyDiscount(baseRateExGst, businessDiscPct) : 0

    // Use negotiated price if customer accepted a counter offer, else fall back to requested price
    const effectivePriceInclGst = negotiatedPriceMap[item.id] ?? (item.requested_price ? Number(item.requested_price) : null)

    if (effectivePriceInclGst != null) {
      // Price is incl-GST — convert to ex-GST for quotation line item calculation.
      const effectiveExGst = effectivePriceInclGst / (1 + gstRate / 100)

      if (baseRateExGst > 0 && effectiveExGst < baseRateExGst) {
        // Negotiated price is below MRP — back-calculate the discount %
        discountPct = Math.round((1 - effectiveExGst / baseRateExGst) * 100 * 100) / 100
      } else if (baseRateExGst > 0) {
        // Negotiated price is at or above MRP — use MRP as rate, show business discount
        discountPct = businessDiscPct
      } else {
        // No MRP on file — use effective price as rate, show business discount
        baseRateExGst = effectiveExGst
        discountPct = businessDiscPct
      }
    } else {
      discountPct = businessDiscPct
    }

    const qty = Number(item.quantity)
    const amount = lineItemExGst(qty, baseRateExGst, discountPct)
    const itemCgst = amount * (gstRate / 2) / 100
    const itemSgst = amount * (gstRate / 2) / 100

    subtotal += amount
    cgst += itemCgst
    sgst += itemSgst

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
      unit: item.unit_display_label || item.unit || 'Nos',
      buy_unit: item.unit || null,
      sold_unit_factor: unitFactor !== 1 ? unitFactor : null,
      rate: baseRateExGst,       // pre-discount rate, so admin can see original and adjust
      discount_pct: discountPct,  // business discount shown separately on the quotation
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
         (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, buy_unit, sold_unit_factor, rate, discount_pct, amount, product_id, variant_id, sub_variant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [qt!.id, idx, li.description, li.hsn_code, li.gst_rate, li.quantity, li.unit, li.buy_unit, li.sold_unit_factor, li.rate, li.discount_pct, li.amount, li.product_id, li.variant_id, li.sub_variant_id]
    )
  }

  await query(
    `UPDATE business_rfqs SET status='converted', converted_quotation_id=$1, updated_at=NOW() WHERE id=$2`,
    [qt!.id, id]
  )

  // Notify business user
  if (rfq.email && qt?.view_token) {
    const viewUrl = `https://quotation.jeffistores.in/${qt.view_token}`
    sendRfqConvertedToQuotationEmail(
      rfq.email,
      rfq.company_name || `${rfq.first_name} ${rfq.last_name}`.trim() || rfq.email,
      rfq.rfq_number,
      qt.quote_number,
      Number(total.toFixed(2)),
      viewUrl,
    ).catch(() => {})
  }

  return NextResponse.json({ quotationId: qt!.id, quoteNumber: qt!.quote_number })
}
