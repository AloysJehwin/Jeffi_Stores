import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const source = searchParams.get('source') || ''
    const search = searchParams.get('search') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const payment = searchParams.get('payment') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = 25
    const offset = (page - 1) * limit

    const conditions: string[] = ['o.invoice_number IS NOT NULL']
    const params: any[] = []
    let i = 1

    if (source) { conditions.push(`o.source = $${i++}`); params.push(source) }
    if (payment) { conditions.push(`o.payment_status = $${i++}`); params.push(payment) }
    if (from) { conditions.push(`o.invoice_date >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`o.invoice_date < ($${i++}::date + interval '1 day')`); params.push(to) }
    if (search) {
      conditions.push(`(o.invoice_number ILIKE $${i} OR o.customer_name ILIKE $${i} OR o.order_number ILIKE $${i})`)
      params.push(`%${search}%`)
      i++
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const [rows, countRow] = await Promise.all([
      queryMany(`
        SELECT
          o.id, o.order_number, o.invoice_number, o.invoice_date,
          o.customer_name, o.customer_phone, o.customer_email,
          o.total_amount, o.taxable_amount, o.cgst_amount, o.sgst_amount, o.igst_amount,
          o.payment_status, o.status, o.source, o.buyer_gstin,
          o.irn, o.irn_status, o.eway_bill_no,
          inv.pdf_url
        FROM orders o
        LEFT JOIN invoices inv ON inv.order_id = o.id
        ${where}
        ORDER BY o.invoice_date DESC, o.created_at DESC
        LIMIT $${i} OFFSET $${i + 1}
      `, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM orders o ${where}`, params),
    ])

    return NextResponse.json({
      invoices: rows,
      total: parseInt(countRow?.count || '0', 10),
      page,
      limit,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
