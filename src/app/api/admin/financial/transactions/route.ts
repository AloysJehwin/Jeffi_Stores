import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const type = searchParams.get('type') || 'all'
    const search = searchParams.get('search') || ''

    const conditions: string[] = []
    const params: any[] = []
    let i = 1

    if (from) { conditions.push(`txn_date >= $${i++}`); params.push(from) }
    if (to) { conditions.push(`txn_date <= $${i++}`); params.push(to) }
    if (type === 'inflow') { conditions.push(`direction = 'inflow'`) }
    if (type === 'outflow') { conditions.push(`direction = 'outflow'`) }
    if (search) {
      conditions.push(`(party ILIKE $${i} OR reference ILIKE $${i} OR txn_ref ILIKE $${i})`)
      params.push(`%${search}%`)
      i++
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await queryMany<any>(`
      SELECT * FROM (
        SELECT
          ep.id,
          'outflow' AS direction,
          ep.payment_date::text AS txn_date,
          ep.amount,
          e.supplier_name AS party,
          e.expense_number AS txn_ref,
          COALESCE(ep.payment_method, 'unknown') AS method,
          ep.reference,
          ep.payout_id,
          ep.payout_status,
          ep.notes,
          ep.created_at
        FROM expense_payments ep
        JOIN expenses e ON e.id = ep.expense_id

        UNION ALL

        SELECT
          o.id,
          'inflow' AS direction,
          (o.updated_at AT TIME ZONE 'UTC')::date::text AS txn_date,
          o.total_amount AS amount,
          COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), o.customer_name) AS party,
          COALESCE(o.invoice_number, o.order_number) AS txn_ref,
          'order' AS method,
          NULL AS reference,
          NULL AS payout_id,
          NULL AS payout_status,
          NULL AS notes,
          o.updated_at AS created_at
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.payment_status = 'paid'
      ) txn
      ${where}
      ORDER BY txn_date DESC, created_at DESC
      LIMIT 500
    `, params)

    const totalInflow = (rows || []).filter((r: any) => r.direction === 'inflow').reduce((s: number, r: any) => s + parseFloat(r.amount), 0)
    const totalOutflow = (rows || []).filter((r: any) => r.direction === 'outflow').reduce((s: number, r: any) => s + parseFloat(r.amount), 0)

    return NextResponse.json({
      rows: rows || [],
      summary: { total_inflow: totalInflow, total_outflow: totalOutflow, net: totalInflow - totalOutflow },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
