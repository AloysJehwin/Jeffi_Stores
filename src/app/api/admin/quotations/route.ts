import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryMany, queryOne } from '@/lib/db'

function calcTotals(items: any[]) {
  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0)
  const cgst = items.reduce((s: number, i: any) => s + i.amount * i.gst_rate / 200, 0)
  const sgst = cgst
  const rawTotal = subtotal + cgst + sgst
  const total = Math.round(rawTotal)
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

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const q = searchParams.get('q') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    const conditions: string[] = []
    const params: any[] = []
    let i = 1

    if (status) { conditions.push(`status = $${i++}`); params.push(status) }
    if (q) { conditions.push(`(consignee_name ILIKE $${i} OR quote_number ILIKE $${i})`); params.push(`%${q}%`); i++ }
    if (from) { conditions.push(`quote_date >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`quote_date <= $${i++}`); params.push(to) }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    params.push(limit)

    const rows = await queryMany(
      `SELECT id, quote_number, quote_date, status, consignee_name, total_amount, created_at
       FROM quotations ${where} ORDER BY created_at DESC LIMIT $${i}`,
      params
    )
    return NextResponse.json({ quotations: rows || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { items = [], ...fields } = body

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one item required' }, { status: 400 })
    }

    const computedItems = items.map((item: any) => ({
      ...item,
      amount: Number(item.quantity) * Number(item.rate) * (1 - (Number(item.discount_pct) || 0) / 100),
    }))
    const totals = calcTotals(computedItems)

    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const fyStart = month >= 3 ? year : year - 1
    const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
    const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month]
    const prefix = `QT/${fy}/${mon}/`

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) FROM quotations WHERE quote_number LIKE $1`,
      [prefix + '%']
    )
    const seq = parseInt(countRow?.count || '0') + 1
    const quoteNumber = buildQuoteNumber(now, seq)

    const qt = await queryOne<any>(
      `INSERT INTO quotations (
        quote_number, quote_date, status,
        consignee_name, consignee_addr1, consignee_addr2, consignee_city, consignee_state, consignee_gstin,
        buyer_same, buyer_name, buyer_addr1, buyer_addr2, buyer_city, buyer_state, buyer_gstin,
        notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by
      ) VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
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
        fields.buyer_same !== false,
        fields.buyer_name || null,
        fields.buyer_addr1 || null,
        fields.buyer_addr2 || null,
        fields.buyer_city || null,
        fields.buyer_state || null,
        fields.buyer_gstin || null,
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
        `INSERT INTO quotation_items (quotation_id, position, description, hsn_code, gst_rate, quantity, unit, rate, discount_pct, amount, product_id, variant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          qt!.id, idx,
          item.description, item.hsn_code || null, Number(item.gst_rate) || 18,
          Number(item.quantity), item.unit || 'PCS', Number(item.rate),
          Number(item.discount_pct) || 0, item.amount,
          item.product_id || null, item.variant_id || null,
        ]
      )
    }

    const savedItems = await queryMany(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt!.id])
    return NextResponse.json({ quotation: qt, items: savedItems }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create quotation' }, { status: 500 })
  }
}
