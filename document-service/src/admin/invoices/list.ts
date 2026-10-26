import { NextRequest, NextResponse } from '../../next'
import { authenticateAdmin } from '../../auth'
import { hasScope } from '../../lib/scopes'
import { queryMany, queryOne } from '@jeffi/tenancy'
import { INVOICES_ENTITY, buildWhere, normalizeQuery } from '@jeffi/list-filters'

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

    // One filter set, applied to each side of the union (cash sales drop out of order-only filters).
    const q = normalizeQuery(INVOICES_ENTITY, searchParams)
    const ow = buildWhere(INVOICES_ENTITY, q, 1, { branch: 'order' })
    const cw = buildWhere(INVOICES_ENTITY, q, ow.nextIdx, { branch: 'cash_sale' })
    const params: unknown[] = [...ow.params, ...cw.params]
    const i = cw.nextIdx

    const unionQuery = `
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
      ${ow.where}
      UNION ALL
      SELECT
        cs.id, cs.sale_number AS order_number, cs.invoice_number, cs.invoice_date,
        cs.customer_name, NULL::text AS customer_phone, NULL::text AS customer_email,
        cs.total_amount, cs.taxable_amount, cs.cgst_amount, cs.sgst_amount, cs.igst_amount,
        cs.payment_status, 'paid'::text AS status, 'cash_sale'::text AS source, NULL::text AS buyer_gstin,
        NULL::text AS irn, NULL::text AS irn_status, NULL::text AS eway_bill_no,
        NULL::text AS pdf_url,
        cs.created_at
      FROM cash_sales cs
      ${cw.where}
    `
    // Whitelisted server-side sort over the full combined set (before LIMIT/OFFSET).
    const sortCol = INVOICES_ENTITY.sorts?.[searchParams.get('sort') || ''] || 'invoice_number'
    const sortDir = (searchParams.get('dir') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const fullQuery = `SELECT * FROM (${unionQuery}) combined ORDER BY ${sortCol} ${sortDir} NULLS LAST, invoice_number DESC NULLS LAST`

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
