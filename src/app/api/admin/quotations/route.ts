import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne } from '@/lib/db'
import { round2 } from '@/lib/gst'
import { buildVectorSearchClause } from '@/lib/search'
import { z } from 'zod'
import { parseBody, zNonEmpty, zEmail } from '@/lib/validate'
import { lineItemExGst } from '@/lib/pricing'

type UnitRow = { unit: string; dimension: string; min_qty: string; max_qty: string | null; qty_step: string }

async function validateLineItemQty(
  productId: string | null,
  variantId: string | null,
  qty: number
): Promise<string | null> {
  if (!productId && !variantId) return null
  let unit: UnitRow | null = null
  if (variantId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE variant_id = $1 AND is_sell_default = true LIMIT 1`,
      [variantId]
    )
  }
  if (!unit && productId) {
    unit = await queryOne<UnitRow>(
      `SELECT unit, dimension, min_qty, max_qty, qty_step FROM product_units
       WHERE product_id = $1 AND variant_id IS NULL AND is_sell_default = true LIMIT 1`,
      [productId]
    )
  }
  if (!unit) return null
  const min = Number(unit.min_qty ?? 1)
  const max = unit.max_qty != null ? Number(unit.max_qty) : null
  const step = Number(unit.qty_step ?? 1)
  if (qty < min) return `Quantity must be at least ${min} ${unit.unit}`
  if (max !== null && qty > max) return `Quantity cannot exceed ${max} ${unit.unit}`
  if (unit.dimension !== 'count' && step > 0) {
    const steps = Math.round((qty - min) / step)
    const snapped = Math.round((min + steps * step) * 1e6) / 1e6
    if (Math.abs(snapped - qty) > 1e-9) return `Quantity must be in steps of ${step} from ${min}`
  }
  return null
}

function calcTotals(items: any[]) {
  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0)
  const cgst = items.reduce((s: number, i: any) => s + i.amount * i.gst_rate / 200, 0)
  const sgst = cgst
  const rawTotal = subtotal + cgst + sgst
  const total = round2(rawTotal)
  return { subtotal, cgst_amount: cgst, sgst_amount: sgst, total_amount: total }
}

function buildQuoteNumber(now: Date, seq: number): string {
  const month = now.getMonth()
  const year = now.getFullYear()
  const fyStart = month >= 3 ? year : year - 1
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
  return `QT/${fy}/${mon}/${seq}`
}

const quotationItemSchema = z.object({
  description: z.string().default(''),
  quantity: z.coerce.number().min(0),
  rate: z.coerce.number().min(0),
  hsn_code: z.string().nullish(),
  gst_rate: z.coerce.number().min(0).default(18),
  unit: z.string().default('PCS'),
  buy_unit: z.string().nullish(),
  discount_pct: z.coerce.number().min(0).default(0),
  product_id: z.string().uuid().nullish(),
  variant_id: z.string().uuid().nullish(),
  sub_variant_id: z.string().uuid().nullish(),
})

const createQuotationSchema = z.object({
  consignee_name: zNonEmpty,
  consignee_email: zEmail.nullish(),
  items: z.array(quotationItemSchema).min(1),
})

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const q = searchParams.get('q') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || searchParams.get('limit') || '25'), 200)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const offset = (page - 1) * pageSize

    const conditions: string[] = []
    const params: any[] = []
    let i = 1

    if (status) { conditions.push(`status = $${i++}`); params.push(status) }
    if (q) {
      const sc = buildVectorSearchClause(q, 'search_vector', ['consignee_name'], ['quote_number'], i, 'simple')
      conditions.push(sc.clause)
      params.push(...sc.params)
      i = sc.nextIdx
    }
    if (from) { conditions.push(`quote_date >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`quote_date <= $${i++}`); params.push(to) }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM quotations ${where}`,
      params
    )
    const total = parseInt(countRow?.total || '0', 10)

    const dataParams = [...params, pageSize, offset]
    const rows = await queryMany(
      `SELECT id, quote_number, quote_date, status, consignee_name, consignee_addr1, consignee_addr2,
              consignee_city, consignee_state, consignee_gstin, consignee_phone, consignee_pincode,
              consignee_email, buyer_same, buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state,
              buyer_gstin,
              CASE WHEN COALESCE(subtotal, 0) = 0
                THEN COALESCE((SELECT SUM(amount) FROM quotation_items WHERE quotation_id = quotations.id), 0)
                ELSE subtotal END AS subtotal,
              CASE WHEN COALESCE(total_amount, 0) = 0
                THEN COALESCE((SELECT SUM(amount * (1 + gst_rate / 100)) FROM quotation_items WHERE quotation_id = quotations.id), 0)
                ELSE total_amount END AS total_amount,
              cgst_amount, sgst_amount, converted_order_id,
              view_token, created_at,
              EXISTS(SELECT 1 FROM business_rfqs WHERE converted_quotation_id = quotations.id) AS from_rfq
       FROM quotations ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      dataParams
    )
    return NextResponse.json({ quotations: rows || [], total, page, pageSize })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    const parsed = parseBody(createQuotationSchema, body, 'POST /api/admin/quotations')
    if (!parsed.ok) return parsed.response

    // Use validated items from parsed.data; merge raw body for non-validated fields (addresses, dates, etc.)
    const { items } = parsed.data
    const fields = { ...body, items: undefined }

    const computedItems = items.map((item: any) => ({
      ...item,
      amount: Number(item.amount) || lineItemExGst(Number(item.quantity), Number(item.rate), Number(item.discount_pct) || 0),
    }))
    const totals = calcTotals(computedItems)

    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const fyStart = month >= 3 ? year : year - 1
    const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
    const prefix = `QT/${fy}/${mon}/`

    const maxRow = await queryOne<{ max_seq: string | null }>(
      `SELECT MAX(CAST(split_part(quote_number, '/', 4) AS INTEGER)) AS max_seq
       FROM quotations WHERE quote_number LIKE $1`,
      [prefix + '%']
    )
    const seq = (parseInt(maxRow?.max_seq || '0') || 0) + 1
    const quoteNumber = buildQuoteNumber(now, seq)

    const qt = await queryOne<any>(
      `INSERT INTO quotations (
        quote_number, quote_date, status,
        consignee_name, consignee_addr1, consignee_addr2, consignee_city, consignee_state, consignee_gstin,
        consignee_phone, consignee_pincode, consignee_email,
        buyer_same, buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state, buyer_gstin,
        buyer_phone, buyer_pincode, buyer_email,
        notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
      ) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      RETURNING *`,
      [
        quoteNumber,
        fields.quote_date || now.toISOString().slice(0, 10),
        fields.consignee_name || '',
        fields.consignee_addr1 || '',
        fields.consignee_addr2 || null,
        fields.consignee_city || '',
        fields.consignee_state || 'Chhattisgarh',
        fields.consignee_gstin || null,
        fields.consignee_phone || null,
        fields.consignee_pincode || null,
        fields.consignee_email || null,
        fields.buyer_same !== false,
        fields.buyer_name || null,
        fields.buyer_addr1 || null,
        fields.buyer_addr2 || null,
        fields.buyer_city || null,
        fields.buyer_state || null,
        fields.buyer_gstin || null,
        fields.buyer_phone || null,
        fields.buyer_pincode || null,
        fields.buyer_email || null,
        fields.notes || null,
        totals.subtotal,
        totals.cgst_amount,
        totals.sgst_amount,
        totals.total_amount,
        admin.adminId,
      ]
    )

    for (let idx = 0; idx < computedItems.length; idx++) {
      const item = computedItems[idx]
      await query(
        `INSERT INTO quotation_items (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, buy_unit, sold_unit_factor, base_quantity, rate, discount_pct, amount, product_id, variant_id, sub_variant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          qt!.id, idx,
          item.description, item.hsn_code || null, Number(item.gst_rate) || 18,
          Number(item.quantity), item.unit || 'PCS', item.buy_unit || null,
          item.sell_unit_factor && item.sell_unit_factor > 1 ? item.sell_unit_factor : null,
          item.sell_unit_factor && item.sell_unit_factor > 1 ? Number(item.quantity) * item.sell_unit_factor : null,
          Number(item.rate),
          Number(item.discount_pct) || 0, item.amount,
          item.product_id || null, item.variant_id || null, item.sub_variant_id || null,
        ]
      )
    }

    const savedItems = await queryMany(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt!.id])
    return NextResponse.json({ quotation: qt, items: savedItems }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create quotation' }, { status: 500 })
  }
}
