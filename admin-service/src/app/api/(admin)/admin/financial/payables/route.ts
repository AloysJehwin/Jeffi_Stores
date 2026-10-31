import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { MAX_SPAN_DAYS, isDate, parsePeriod, spanDays } from '@/lib/overview/period'
import { getPayablesOverview } from './summary'

export const dynamic = 'force-dynamic'

// Payables overview — FinanceOverviewContract<PayablesTotals, Bill|Supplier> shape.
export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial:read'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const sp = request.nextUrl.searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    if ((from || to) && !(isDate(from) && isDate(to) && from <= to && spanDays({ from, to }) <= MAX_SPAN_DAYS))
      return NextResponse.json(
        { error: `from and to must be YYYY-MM-DD, from <= to, at most ${MAX_SPAN_DAYS} days` },
        { status: 400 }
      )

    return NextResponse.json(await getPayablesOverview(parsePeriod(from, to)))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()
    const { supplier_name, supplier_gstin, description, amount, tax_amount, expense_date, due_date, notes } = body

    if (!supplier_name || !amount || !expense_date) {
      return NextResponse.json({ error: 'supplier_name, amount, and expense_date are required' }, { status: 400 })
    }

    const amountNum = parseFloat(amount)
    const taxNum = parseFloat(tax_amount || '0')
    const totalNum = amountNum + taxNum

    const seq = await queryOne<{ count: string }>('SELECT COUNT(*)::int AS count FROM expenses')
    const expenseNumber = `EXP-${String(parseInt(seq?.count || '0') + 1).padStart(4, '0')}`

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO expenses (expense_number, supplier_name, supplier_gstin, description, amount, tax_amount, total_amount, expense_date, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        expenseNumber,
        supplier_name,
        supplier_gstin || null,
        description || null,
        amountNum,
        taxNum,
        totalNum,
        expense_date,
        due_date || null,
        notes || null,
      ]
    )

    return NextResponse.json({ success: true, id: inserted?.id, expense_number: expenseNumber })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
