import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { buildWhere, normalizeQuery } from '@jeffi/list-filters'
import { queryMany, queryOne } from '@/lib/shared/db'
import { CASH_SALE_ENTITY, CASH_SALE_SORTS } from '@/lib/filters/entities/cash-sale'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = 25
    const offset = (page - 1) * limit

    // The list filters (old ?payment= included); from / to are the bill date.
    const w = buildWhere(CASH_SALE_ENTITY, normalizeQuery(CASH_SALE_ENTITY, searchParams))
    const where = w.where
    const params = w.params
    const i = w.nextIdx

    const sortCol = CASH_SALE_SORTS[searchParams.get('sort') || ''] || null
    const sortDir = (searchParams.get('dir') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const orderBy = sortCol
      ? `ORDER BY ${sortCol} ${sortDir} NULLS LAST, cs.created_at DESC`
      : `ORDER BY cs.created_at DESC`

    const [rows, countRow] = await Promise.all([
      queryMany(
        `
        SELECT
          cs.id, cs.sale_number AS order_number, cs.invoice_number, cs.invoice_date,
          cs.customer_name, cs.total_amount, cs.taxable_amount,
          cs.cgst_amount, cs.sgst_amount, cs.igst_amount,
          cs.payment_status, cs.payment_mode, cs.notes
        FROM cash_sales cs
        ${where}
        ${orderBy}
        LIMIT $${i} OFFSET $${i + 1}
      `,
        [...params, limit, offset]
      ),
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
