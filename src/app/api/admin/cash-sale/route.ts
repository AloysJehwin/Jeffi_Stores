import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany, queryOne } from '@/lib/db'
import { buildVectorSearchClause } from '@/lib/search'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const payment = searchParams.get('payment') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = 25
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let i = 1

    if (payment) { conditions.push(`cs.payment_status = $${i++}`); params.push(payment) }
    if (from) { conditions.push(`cs.invoice_date >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`cs.invoice_date < ($${i++}::date + interval '1 day')`); params.push(to) }
    if (search) {
      const sc = buildVectorSearchClause(search, 'cs.search_vector', ['cs.customer_name'], ['cs.invoice_number', 'cs.sale_number'], i, 'simple')
      conditions.push(sc.clause)
      params.push(...sc.params)
      i = sc.nextIdx
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // Whitelisted server-side sort (real cash_sales columns).
    const SORT_COLS: Record<string, string> = {
      invoice_number: 'cs.invoice_number', invoice_date: 'cs.invoice_date',
      total_amount: 'cs.total_amount', payment_status: 'cs.payment_status',
    }
    const sortCol = SORT_COLS[searchParams.get('sort') || ''] || null
    const sortDir = (searchParams.get('dir') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const orderBy = sortCol
      ? `ORDER BY ${sortCol} ${sortDir} NULLS LAST, cs.created_at DESC`
      : `ORDER BY cs.created_at DESC`

    const [rows, countRow] = await Promise.all([
      queryMany(`
        SELECT
          cs.id, cs.sale_number AS order_number, cs.invoice_number, cs.invoice_date,
          cs.customer_name, cs.total_amount, cs.taxable_amount,
          cs.cgst_amount, cs.sgst_amount, cs.igst_amount,
          cs.payment_status, cs.payment_mode, cs.notes
        FROM cash_sales cs
        ${where}
        ${orderBy}
        LIMIT $${i} OFFSET $${i + 1}
      `, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM cash_sales cs ${where}`, params),
    ])

    return NextResponse.json({
      sales: rows,
      total: parseInt(countRow?.count || '0', 10),
      page,
      limit,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
