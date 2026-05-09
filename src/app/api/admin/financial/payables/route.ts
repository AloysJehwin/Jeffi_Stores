import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { getPayables } from '@/lib/financial'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''

    const result = await getPayables({
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      search: search || undefined,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { supplier_name, supplier_gstin, description, amount, tax_amount, expense_date, due_date, notes } = body

    if (!supplier_name || !amount || !expense_date) {
      return NextResponse.json({ error: 'supplier_name, amount, and expense_date are required' }, { status: 400 })
    }

    const amountNum = parseFloat(amount)
    const taxNum = parseFloat(tax_amount || '0')
    const totalNum = amountNum + taxNum

    const seq = await queryOne<{ count: string }>('SELECT COUNT(*)::int AS count FROM expenses')
    const expenseNumber = `EXP-${String((parseInt(seq?.count || '0') + 1)).padStart(4, '0')}`

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO expenses (expense_number, supplier_name, supplier_gstin, description, amount, tax_amount, total_amount, expense_date, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [expenseNumber, supplier_name, supplier_gstin || null, description || null, amountNum, taxNum, totalNum,
       expense_date, due_date || null, notes || null]
    )

    return NextResponse.json({ success: true, id: inserted?.id, expense_number: expenseNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
