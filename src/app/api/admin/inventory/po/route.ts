import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const supplierId = searchParams.get('supplier_id') || ''

    const conditions = ['1=1']
    const params: any[] = []
    let i = 1

    if (status) { conditions.push(`po.status = $${i++}`); params.push(status) }
    if (supplierId) { conditions.push(`po.supplier_id = $${i++}`); params.push(supplierId) }
    if (search) {
      conditions.push(`(po.po_number ILIKE $${i} OR s.name ILIKE $${i})`)
      params.push(`%${search}%`)
      i++
    }

    const rows = await queryMany<any>(
      `SELECT
         po.id, po.po_number, po.status, po.order_date, po.expected_date,
         po.subtotal, po.tax_amount, po.total_amount, po.notes, po.created_at,
         s.id AS supplier_id, s.name AS supplier_name,
         COUNT(poi.id)::int AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY po.id, s.id
       ORDER BY po.created_at DESC`,
      params
    )

    return NextResponse.json({ purchase_orders: rows || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { supplier_id, order_date, expected_date, notes, status = 'draft', items } = body

    if (!supplier_id) return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const countRow = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM purchase_orders WHERE po_number LIKE $1`,
      [`PO-${datePart}-%`]
    )
    const seq = String((countRow?.cnt || 0) + 1).padStart(4, '0')
    const poNumber = `PO-${datePart}-${seq}`

    let subtotal = 0
    let taxAmount = 0
    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0
      const cost = parseFloat(item.unit_cost) || 0
      const tax = parseFloat(item.tax_rate) || 0
      subtotal += qty * cost
      taxAmount += qty * cost * (tax / 100)
    }
    const totalAmount = subtotal + taxAmount

    const po = await queryOne<{ id: string }>(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, subtotal, tax_amount, total_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [poNumber, supplier_id, status,
       order_date || new Date().toISOString().slice(0, 10),
       expected_date || null, notes || null,
       Math.round(subtotal * 100) / 100,
       Math.round(taxAmount * 100) / 100,
       Math.round(totalAmount * 100) / 100]
    )

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0
      const cost = parseFloat(item.unit_cost) || 0
      const tax = parseFloat(item.tax_rate) || 0
      const total = Math.round(qty * cost * (1 + tax / 100) * 100) / 100
      await query(
        `INSERT INTO purchase_order_items (po_id, product_id, variant_id, product_name, sku, quantity, unit_cost, tax_rate, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [po?.id, item.product_id, item.variant_id || null,
         item.product_name, item.sku || null,
         qty, cost, tax, total]
      )
    }

    return NextResponse.json({ success: true, id: po?.id, po_number: poNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
