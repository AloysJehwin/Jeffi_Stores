import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supplier = await queryOne<any>(
      `SELECT s.*,
        COUNT(DISTINCT po.id)::int AS po_count,
        COALESCE(SUM(po.total_amount), 0) AS po_total,
        COUNT(DISTINCT e.id)::int AS expense_count,
        COALESCE(SUM(e.total_amount), 0) AS expense_total
       FROM suppliers s
       LEFT JOIN purchase_orders po ON po.supplier_id = s.id
       LEFT JOIN expenses e ON e.po_id = po.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [params.id]
    )

    if (!supplier) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const pos = await queryMany<any>(
      `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date,
              po.total_amount, po.received_amount, po.notes
       FROM purchase_orders po
       WHERE po.supplier_id = $1
       ORDER BY po.order_date DESC
       LIMIT 50`,
      [params.id]
    )

    const expenses = await queryMany<any>(
      `SELECT e.id, e.expense_number, e.expense_date, e.due_date,
              e.amount, e.tax_amount, e.total_amount, e.status,
              e.description, po.po_number
       FROM expenses e
       LEFT JOIN purchase_orders po ON po.id = e.po_id
       WHERE po.supplier_id = $1
       ORDER BY e.expense_date DESC
       LIMIT 50`,
      [params.id]
    )

    return NextResponse.json({ supplier, pos: pos || [], expenses: expenses || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
