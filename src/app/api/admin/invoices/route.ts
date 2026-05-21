import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { buildVectorSearchClause } from '@/lib/search'

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

    const orderConditions: string[] = ['o.invoice_number IS NOT NULL', "o.source != 'cash_sale'"]
    const csConditions: string[] = ['cs.invoice_number IS NOT NULL']
    const params: any[] = []
    let i = 1

    const showOrders = !source || source !== 'cash_sale'
    const showCashSales = !source || source === 'cash_sale'

    if (source && source !== 'cash_sale') { orderConditions.push(`o.source = $${i++}`); params.push(source) }
    if (payment) {
      if (showOrders) { orderConditions.push(`o.payment_status = $${i}`) }
      if (showCashSales) { csConditions.push(`cs.payment_status = $${i}`) }
      params.push(payment); i++
    }
    if (from) {
      if (showOrders) { orderConditions.push(`o.invoice_date >= $${i}`) }
      if (showCashSales) { csConditions.push(`cs.invoice_date >= $${i}`) }
      params.push(from); i++
    }
    if (to) {
      if (showOrders) { orderConditions.push(`o.invoice_date < ($${i}::date + interval '1 day')`) }
      if (showCashSales) { csConditions.push(`cs.invoice_date < ($${i}::date + interval '1 day')`) }
      params.push(to); i++
    }
    if (search) {
      if (showOrders && showCashSales) {
        const sc = buildVectorSearchClause(search, 'o.search_vector', ['o.customer_name'], ['o.invoice_number', 'o.order_number'], i, 'simple')
        orderConditions.push(sc.clause)
        const csSc = buildVectorSearchClause(search, 'cs.search_vector', ['cs.customer_name'], ['cs.invoice_number', 'cs.sale_number'], i, 'simple')
        csConditions.push(csSc.clause)
        params.push(...sc.params)
        i = sc.nextIdx
      } else if (showOrders) {
        const sc = buildVectorSearchClause(search, 'o.search_vector', ['o.customer_name'], ['o.invoice_number', 'o.order_number'], i, 'simple')
        orderConditions.push(sc.clause)
        params.push(...sc.params)
        i = sc.nextIdx
      } else if (showCashSales) {
        const sc = buildVectorSearchClause(search, 'cs.search_vector', ['cs.customer_name'], ['cs.invoice_number', 'cs.sale_number'], i, 'simple')
        csConditions.push(sc.clause)
        params.push(...sc.params)
        i = sc.nextIdx
      }
    }

    const orderWhere = `WHERE ${orderConditions.join(' AND ')}`
    const csWhere = `WHERE ${csConditions.join(' AND ')}`

    const orderQuery = showOrders ? `
      SELECT
        o.id, o.order_number, o.invoice_number, o.invoice_date,
        o.customer_name, o.customer_phone, o.customer_email,
        o.total_amount, o.taxable_amount, o.cgst_amount, o.sgst_amount, o.igst_amount,
        o.payment_status, o.status, o.source, o.buyer_gstin,
        o.irn, o.irn_status, o.eway_bill_no,
        inv.pdf_url,
        o.created_at
      FROM orders o
      LEFT JOIN invoices inv ON inv.order_id = o.id
      ${orderWhere}
    ` : null

    const csQuery = showCashSales ? `
      SELECT
        cs.id, cs.sale_number AS order_number, cs.invoice_number, cs.invoice_date,
        cs.customer_name, NULL::text AS customer_phone, NULL::text AS customer_email,
        cs.total_amount, cs.taxable_amount, cs.cgst_amount, cs.sgst_amount, cs.igst_amount,
        cs.payment_status, 'paid'::text AS status, 'cash_sale'::text AS source, NULL::text AS buyer_gstin,
        NULL::text AS irn, NULL::text AS irn_status, NULL::text AS eway_bill_no,
        NULL::text AS pdf_url,
        cs.created_at
      FROM cash_sales cs
      ${csWhere}
    ` : null

    const unionQuery = [orderQuery, csQuery].filter(Boolean).join('\nUNION ALL\n')
    const fullQuery = `SELECT * FROM (${unionQuery}) combined ORDER BY invoice_date DESC NULLS LAST, created_at DESC`

    const [rows, countRow] = await Promise.all([
      queryMany(`${fullQuery} LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM (${unionQuery}) combined`, params),
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
