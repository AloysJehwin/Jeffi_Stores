import { queryOne, queryMany } from './db'
import { buildSearchClause, buildVectorSearchClause } from './search'

export interface ReceivableRow {
  order_id: string
  order_number: string
  invoice_number: string | null
  customer_name: string
  customer_phone: string
  invoice_date: string
  total_amount: number
  payment_status: string
  days_outstanding: number
  aging_bucket: '0-30' | '31-60' | '60+'
  user_id: string | null
  credit_limit: number
}

export interface ReceivablesSummary {
  total: number
  bucket_0_30: number
  bucket_31_60: number
  bucket_60plus: number
}

export interface PayableRow {
  id: string
  expense_number: string
  supplier_name: string
  supplier_gstin: string | null
  description: string | null
  amount: number
  tax_amount: number
  total_amount: number
  expense_date: string
  due_date: string | null
  status: string
  days_overdue: number | null
  paid_amount: number
  po_id: string | null
  supplier_bank_name: string | null
  supplier_account_number: string | null
  supplier_ifsc: string | null
  supplier_upi_id: string | null
}

export interface PayablesSummary {
  total_payable: number
  due_this_week: number
  overdue: number
}

export interface PLMonth {
  month: string
  revenue: number
  cogs: number
  gross_profit: number
  gross_margin_pct: number
  tax_collected: number
  order_count: number
}

export interface PLTotals {
  revenue: number
  cogs: number
  gross_profit: number
  gross_margin_pct: number
  tax_collected: number
  order_count: number
}

export interface CashflowMonth {
  month: string
  cash_in: number
  cash_out: number
  net: number
  running_balance: number
}

export interface CustomerCreditStatus {
  credit_limit: number
  outstanding: number
  available: number
  is_over_limit: boolean
}

export async function getReceivablesAging(filters: {
  from?: string
  to?: string
  customerPhone?: string
  search?: string
}): Promise<{ rows: ReceivableRow[]; summary: ReceivablesSummary }> {
  const conditions: string[] = ["o.payment_status IN ('unpaid', 'partial')", "o.status != 'draft'"]
  const params: any[] = []
  let i = 1

  if (filters.from) { conditions.push(`o.created_at >= $${i++}`); params.push(filters.from) }
  if (filters.to) { conditions.push(`o.created_at <= $${i++}`); params.push(filters.to + ' 23:59:59') }
  if (filters.customerPhone) { conditions.push(`o.customer_phone = $${i++}`); params.push(filters.customerPhone) }
  if (filters.search) {
    const sc = buildVectorSearchClause(filters.search, 'o.search_vector', ['o.customer_name'], ['o.invoice_number', 'o.order_number'], i, 'simple')
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.join(' AND ')

  const rows = await queryMany<ReceivableRow>(`
    SELECT
      o.id AS order_id,
      o.order_number,
      o.invoice_number,
      o.customer_name,
      o.customer_phone,
      COALESCE(o.invoice_date, o.created_at)::date AS invoice_date,
      o.total_amount,
      o.payment_status,
      o.user_id,
      COALESCE(cp.credit_limit, 0) AS credit_limit,
      EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at))::int AS days_outstanding,
      CASE
        WHEN EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at)) <= 30 THEN '0-30'
        WHEN EXTRACT(DAY FROM NOW() - COALESCE(o.invoice_date, o.created_at)) <= 60 THEN '31-60'
        ELSE '60+'
      END AS aging_bucket
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_profiles cp ON cp.user_id = o.user_id
    WHERE ${where}
    ORDER BY days_outstanding DESC
  `, params)

  const summary: ReceivablesSummary = {
    total: 0,
    bucket_0_30: 0,
    bucket_31_60: 0,
    bucket_60plus: 0,
  }
  for (const r of (rows || [])) {
    const amt = parseFloat(r.total_amount as any)
    summary.total += amt
    if (r.aging_bucket === '0-30') summary.bucket_0_30 += amt
    else if (r.aging_bucket === '31-60') summary.bucket_31_60 += amt
    else summary.bucket_60plus += amt
  }

  return { rows: rows || [], summary }
}

export async function getPayables(filters: {
  status?: string
  from?: string
  to?: string
  search?: string
}): Promise<{ rows: PayableRow[]; summary: PayablesSummary }> {
  const conditions: string[] = ['1=1']
  const params: any[] = []
  let i = 1

  if (filters.status && filters.status !== 'all') {
    conditions.push(`e.status = $${i++}`)
    params.push(filters.status)
  } else {
    conditions.push(`e.status != 'paid'`)
  }
  if (filters.from) { conditions.push(`e.expense_date >= $${i++}`); params.push(filters.from) }
  if (filters.to) { conditions.push(`e.expense_date <= $${i++}`); params.push(filters.to) }
  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['e.supplier_name', 'e.expense_number'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const rows = await queryMany<PayableRow>(`
    SELECT
      e.id, e.expense_number, e.supplier_name, e.supplier_gstin,
      e.description, e.amount, e.tax_amount, e.total_amount,
      e.expense_date::text, e.due_date::text, e.status, e.po_id,
      CASE WHEN e.due_date < CURRENT_DATE THEN EXTRACT(DAY FROM NOW() - e.due_date)::int ELSE NULL END AS days_overdue,
      COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) AS paid_amount,
      s.bank_name AS supplier_bank_name,
      s.account_number AS supplier_account_number,
      s.ifsc AS supplier_ifsc,
      s.upi_id AS supplier_upi_id
    FROM expenses e
    LEFT JOIN purchase_orders po ON po.id = e.po_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.due_date ASC NULLS LAST, e.expense_date DESC
  `, params)

  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const summary: PayablesSummary = { total_payable: 0, due_this_week: 0, overdue: 0 }
  for (const r of (rows || [])) {
    const remaining = parseFloat(r.total_amount as any) - parseFloat(r.paid_amount as any)
    summary.total_payable += remaining
    if (r.due_date) {
      const due = new Date(r.due_date)
      if (due < now) summary.overdue += remaining
      else if (due <= weekFromNow) summary.due_this_week += remaining
    }
  }

  return { rows: rows || [], summary }
}

export async function getPLReport(from: string, to: string): Promise<{ monthly: PLMonth[]; totals: PLTotals }> {
  const rows = await queryMany<any>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', o.created_at), 'YYYY-MM') AS month,
      COALESCE(SUM(o.total_amount), 0) AS revenue,
      COALESCE(SUM(o.tax_amount), 0) AS tax_collected,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(
        (SELECT COALESCE(SUM(oi.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0)
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         WHERE oi.order_id = o.id)
      ), 0) AS cogs
    FROM orders o
    WHERE o.payment_status = 'paid'
      AND o.created_at >= $1
      AND o.created_at <= $2
    GROUP BY DATE_TRUNC('month', o.created_at)
    ORDER BY DATE_TRUNC('month', o.created_at)
  `, [from, to + ' 23:59:59'])

  const monthly: PLMonth[] = (rows || []).map(r => {
    const revenue = parseFloat(r.revenue)
    const cogs = parseFloat(r.cogs)
    const gross_profit = revenue - cogs
    return {
      month: r.month,
      revenue,
      cogs,
      gross_profit,
      gross_margin_pct: revenue > 0 ? Math.round((gross_profit / revenue) * 10000) / 100 : 0,
      tax_collected: parseFloat(r.tax_collected),
      order_count: r.order_count,
    }
  })

  const totals = monthly.reduce<PLTotals>((acc, m) => ({
    revenue: acc.revenue + m.revenue,
    cogs: acc.cogs + m.cogs,
    gross_profit: acc.gross_profit + m.gross_profit,
    gross_margin_pct: 0,
    tax_collected: acc.tax_collected + m.tax_collected,
    order_count: acc.order_count + m.order_count,
  }), { revenue: 0, cogs: 0, gross_profit: 0, gross_margin_pct: 0, tax_collected: 0, order_count: 0 })
  totals.gross_margin_pct = totals.revenue > 0
    ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100
    : 0

  return { monthly, totals }
}

export async function getCashflow(from: string, to: string): Promise<{ monthly: CashflowMonth[] }> {
  const [inRows, outRows] = await Promise.all([
    queryMany<{ month: string; cash_in: string }>(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(total_amount), 0) AS cash_in
      FROM orders
      WHERE payment_status = 'paid'
        AND created_at >= $1 AND created_at <= $2
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `, [from, to + ' 23:59:59']),
    queryMany<{ month: string; cash_out: string }>(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', ep.payment_date::timestamp), 'YYYY-MM') AS month,
        COALESCE(SUM(ep.amount), 0) AS cash_out
      FROM expense_payments ep
      WHERE ep.payment_date >= $1::date AND ep.payment_date <= $2::date
      GROUP BY DATE_TRUNC('month', ep.payment_date::timestamp)
      ORDER BY DATE_TRUNC('month', ep.payment_date::timestamp)
    `, [from, to]),
  ])

  const monthSet = new Set<string>()
  ;(inRows || []).forEach(r => monthSet.add(r.month))
  ;(outRows || []).forEach(r => monthSet.add(r.month))

  const inMap: Record<string, number> = {}
  ;(inRows || []).forEach(r => { inMap[r.month] = parseFloat(r.cash_in) })
  const outMap: Record<string, number> = {}
  ;(outRows || []).forEach(r => { outMap[r.month] = parseFloat(r.cash_out) })

  const sortedMonths = Array.from(monthSet).sort()
  let running = 0
  const monthly: CashflowMonth[] = sortedMonths.map(month => {
    const cash_in = inMap[month] || 0
    const cash_out = outMap[month] || 0
    const net = cash_in - cash_out
    running += net
    return { month, cash_in, cash_out, net, running_balance: Math.round(running * 100) / 100 }
  })

  return { monthly }
}

export async function getCustomerCreditStatus(userId: string): Promise<CustomerCreditStatus> {
  const [profile, outstanding] = await Promise.all([
    queryOne<{ credit_limit: string }>(`
      SELECT credit_limit FROM customer_profiles WHERE user_id = $1
    `, [userId]),
    queryOne<{ outstanding: string }>(`
      SELECT COALESCE(SUM(total_amount), 0) AS outstanding
      FROM orders
      WHERE user_id = $1 AND payment_status IN ('unpaid', 'partial')
    `, [userId]),
  ])

  const credit_limit = parseFloat(profile?.credit_limit || '0')
  const outstanding_amt = parseFloat(outstanding?.outstanding || '0')
  return {
    credit_limit,
    outstanding: outstanding_amt,
    available: Math.max(0, credit_limit - outstanding_amt),
    is_over_limit: outstanding_amt >= credit_limit && credit_limit > 0,
  }
}
