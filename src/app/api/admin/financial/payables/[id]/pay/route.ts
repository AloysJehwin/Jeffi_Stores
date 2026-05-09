import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { amount, payment_date, payment_method, reference, notes } = body

    if (!amount || !payment_date) {
      return NextResponse.json({ error: 'amount and payment_date are required' }, { status: 400 })
    }

    const expense = await queryOne<{ id: string; total_amount: string; status: string }>(
      'SELECT id, total_amount, status FROM expenses WHERE id = $1',
      [params.id]
    )
    if (!expense) return NextResponse.json({ error: 'Expense not found' }, { status: 404 })

    await query(
      `INSERT INTO expense_payments (expense_id, amount, payment_date, payment_method, reference, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [params.id, parseFloat(amount), payment_date, payment_method || null, reference || null, notes || null]
    )

    const paidResult = await queryOne<{ paid: string }>(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM expense_payments WHERE expense_id = $1',
      [params.id]
    )
    const paid = parseFloat(paidResult?.paid || '0')
    const total = parseFloat(expense.total_amount)
    const newStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    await query('UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, params.id])

    return NextResponse.json({ success: true, new_status: newStatus, total_paid: paid })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
