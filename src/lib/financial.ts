import { queryOne, queryMany } from './db'
import { buildSearchClause, buildVectorSearchClause } from './search'
import { round2 } from './gst'

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
  refunds: number
  net_revenue: number
  cogs: number
  gross_profit: number
  gross_margin_pct: number
  operating_expenses: number
  operating_profit: number
  tax_collected: number
  order_count: number
  revenue_online: number
  revenue_business: number
  revenue_cash_sale: number
  revenue_offline: number
}

export interface PLTotals {
  revenue: number
  refunds: number
  net_revenue: number
  cogs: number
  gross_profit: number
  gross_margin_pct: number
  operating_expenses: number
  operating_profit: number
  tax_collected: number
  order_count: number
  revenue_online: number
  revenue_business: number
  revenue_cash_sale: number
  revenue_offline: number
}

export interface CashflowMonth {
  month: string
  cash_in: number
  cash_in_online: number
  cash_in_business: number
  cash_in_cash_sale: number
  cash_in_offline: number
  po_payments: number
  refunds_out: number
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
  page?: number
  pageSize?: number
}): Promise<{ rows: ReceivableRow[]; summary: ReceivablesSummary; total: number }> {
  const PAGE_SIZE = filters.pageSize ?? 50
  const offset = ((filters.page ?? 1) - 1) * PAGE_SIZE

  const conditions: string[] = [
    "o.payment_status IN ('unpaid', 'partial')",
    "o.status NOT IN ('draft', 'cancelled', 'cancel_rejected', 'returned')",
  ]
  const params: any[] = []
  let i = 1

  if (filters.from) {
    conditions.push(`o.created_at >= $${i++}`)
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push(`o.created_at <= $${i++}`)
    params.push(filters.to + ' 23:59:59')
  }
  if (filters.customerPhone) {
    conditions.push(`o.customer_phone = $${i++}`)
    params.push(filters.customerPhone)
  }
  if (filters.search) {
    const sc = buildVectorSearchClause(
      filters.search,
      'o.search_vector',
      ['o.customer_name'],
      ['o.invoice_number', 'o.order_number'],
      i,
      'simple'
    )
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const where = conditions.join(' AND ')

  const [countRow, rows] = await Promise.all([
    queryOne<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
    `,
      params
    ),
    queryMany<ReceivableRow>(
      `
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
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
      params
    ),
  ])

  const total = parseInt(countRow?.count ?? '0', 10)

  const summary: ReceivablesSummary = {
    total: 0,
    bucket_0_30: 0,
    bucket_31_60: 0,
    bucket_60plus: 0,
  }
  for (const r of rows || []) {
    const amt = parseFloat(r.total_amount as any)
    summary.total += amt
    if (r.aging_bucket === '0-30') summary.bucket_0_30 += amt
    else if (r.aging_bucket === '31-60') summary.bucket_31_60 += amt
    else summary.bucket_60plus += amt
  }

  return { rows: rows || [], summary, total }
}

export async function getPayables(filters: {
  status?: string
  from?: string
  to?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<{ rows: PayableRow[]; summary: PayablesSummary; total: number }> {
  const PAGE_SIZE = filters.pageSize ?? 50
  const offset = ((filters.page ?? 1) - 1) * PAGE_SIZE

  const conditions: string[] = ['1=1']
  const params: any[] = []
  let i = 1

  if (filters.status && filters.status !== 'all') {
    conditions.push(`e.status = $${i++}`)
    params.push(filters.status)
  } else {
    conditions.push(`e.status != 'paid'`)
  }
  if (filters.from) {
    conditions.push(`e.expense_date >= $${i++}`)
    params.push(filters.from)
  }
  if (filters.to) {
    conditions.push(`e.expense_date <= $${i++}`)
    params.push(filters.to)
  }
  if (filters.search) {
    const sc = buildSearchClause(filters.search, ['e.supplier_name', 'e.expense_number'], i)
    conditions.push(sc.clause)
    params.push(...sc.params)
    i = sc.nextIdx
  }

  const [countRow, rows] = await Promise.all([
    queryOne<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM expenses e
      LEFT JOIN purchase_orders po ON po.id = e.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${conditions.join(' AND ')}
    `,
      params
    ),
    queryMany<PayableRow>(
      `
      SELECT
        e.id, e.expense_number, e.supplier_name, e.supplier_gstin,
        e.description, e.amount, e.tax_amount, e.total_amount,
        e.expense_date::text, e.due_date::text, e.status, e.po_id,
        CASE WHEN e.due_date < CURRENT_DATE THEN EXTRACT(DAY FROM NOW() - e.due_date)::int ELSE NULL END AS days_overdue,
        COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) AS paid_amount,
        s.bank_name AS supplier_bank_name,
        s.account_number AS supplier_account_number,
        s.ifsc AS supplier_ifsc,
        s.upi_id AS supplier_upi_id,
        s.id AS supplier_id
      FROM expenses e
      LEFT JOIN purchase_orders po ON po.id = e.po_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.due_date ASC NULLS LAST, e.expense_date DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `,
      params
    ),
  ])

  const total = parseInt(countRow?.count ?? '0', 10)

  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const summary: PayablesSummary = { total_payable: 0, due_this_week: 0, overdue: 0 }
  for (const r of rows || []) {
    const remaining = parseFloat(r.total_amount as any) - parseFloat(r.paid_amount as any)
    summary.total_payable += remaining
    if (r.due_date) {
      const due = new Date(r.due_date)
      if (due < now) summary.overdue += remaining
      else if (due <= weekFromNow) summary.due_this_week += remaining
    }
  }

  return { rows: rows || [], summary, total }
}

export async function getPLReport(from: string, to: string): Promise<{ monthly: PLMonth[]; totals: PLTotals }> {
  const toTs = to + ' 23:59:59'

  const [revenueRows, refundRows, opexRows] = await Promise.all([
    // Revenue: paid active orders, grouped by month + source
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', COALESCE(o.invoice_date, o.created_at)), 'YYYY-MM') AS month,
        o.source,
        COALESCE(SUM(o.total_amount), 0)  AS revenue,
        COALESCE(SUM(o.tax_amount), 0)    AS tax_collected,
        COUNT(*)::int                      AS order_count,
        COALESCE(SUM(cogs.line_cogs), 0)  AS cogs
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(oi.quantity * COALESCE(pv.cost_price, p.cost_price, 0)), 0) AS line_cogs
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = o.id
      ) cogs ON TRUE
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
        AND COALESCE(o.invoice_date, o.created_at) >= $1
        AND COALESCE(o.invoice_date, o.created_at) <= $2
      GROUP BY 1, 2

      UNION ALL

      SELECT
        TO_CHAR(DATE_TRUNC('month', cs.created_at), 'YYYY-MM') AS month,
        'cash_sale' AS source,
        COALESCE(SUM(cs.total_amount), 0),
        COALESCE(SUM(cs.tax_amount), 0),
        COUNT(*)::int,
        0
      FROM cash_sales cs
      WHERE cs.payment_status = 'paid'
        AND cs.created_at >= $1
        AND cs.created_at <= $2
      GROUP BY 1, 2
    `,
      [from, toTs]
    ),

    // Refunds: cancelled/returned orders that had been paid
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', COALESCE(o.invoice_date, o.created_at)), 'YYYY-MM') AS month,
        COALESCE(SUM(o.total_amount), 0) AS refunds
      FROM orders o
      WHERE o.status IN ('cancelled', 'returned')
        AND o.payment_status = 'paid'
        AND COALESCE(o.invoice_date, o.created_at) >= $1
        AND COALESCE(o.invoice_date, o.created_at) <= $2
      GROUP BY 1
    `,
      [from, toTs]
    ),

    // Operating expenses: actual supplier/PO payments made
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', ep.payment_date::timestamp), 'YYYY-MM') AS month,
        COALESCE(SUM(ep.amount), 0) AS operating_expenses
      FROM expense_payments ep
      WHERE ep.payment_date >= $1::date
        AND ep.payment_date <= $2::date
      GROUP BY 1
    `,
      [from, to]
    ),
  ])

  // Merge by month
  const monthMap: Record<string, PLMonth> = {}

  const ensureMonth = (m: string) => {
    if (!monthMap[m]) {
      monthMap[m] = {
        month: m,
        revenue: 0,
        refunds: 0,
        net_revenue: 0,
        cogs: 0,
        gross_profit: 0,
        gross_margin_pct: 0,
        operating_expenses: 0,
        operating_profit: 0,
        tax_collected: 0,
        order_count: 0,
        revenue_online: 0,
        revenue_business: 0,
        revenue_cash_sale: 0,
        revenue_offline: 0,
      }
    }
    return monthMap[m]
  }

  for (const r of revenueRows || []) {
    const row = ensureMonth(r.month)
    const rev = parseFloat(r.revenue)
    row.revenue += rev
    row.tax_collected += parseFloat(r.tax_collected)
    row.order_count += r.order_count
    row.cogs += parseFloat(r.cogs)
    if (r.source === 'online') row.revenue_online += rev
    else if (r.source === 'business') row.revenue_business += rev
    else if (r.source === 'cash_sale') row.revenue_cash_sale += rev
    else row.revenue_offline += rev
  }

  for (const r of refundRows || []) {
    const row = ensureMonth(r.month)
    row.refunds += parseFloat(r.refunds)
  }

  for (const r of opexRows || []) {
    const row = ensureMonth(r.month)
    row.operating_expenses += parseFloat(r.operating_expenses)
  }

  // Compute derived fields
  for (const row of Object.values(monthMap)) {
    row.net_revenue = row.revenue - row.refunds
    row.gross_profit = row.net_revenue - row.cogs
    row.gross_margin_pct = row.net_revenue > 0 ? round2((row.gross_profit / row.net_revenue) * 100) : 0
    row.operating_profit = row.gross_profit - row.operating_expenses
  }

  const monthly = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month))

  const zero: PLTotals = {
    revenue: 0,
    refunds: 0,
    net_revenue: 0,
    cogs: 0,
    gross_profit: 0,
    gross_margin_pct: 0,
    operating_expenses: 0,
    operating_profit: 0,
    tax_collected: 0,
    order_count: 0,
    revenue_online: 0,
    revenue_business: 0,
    revenue_cash_sale: 0,
    revenue_offline: 0,
  }
  const totals = monthly.reduce<PLTotals>(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      refunds: acc.refunds + m.refunds,
      net_revenue: acc.net_revenue + m.net_revenue,
      cogs: acc.cogs + m.cogs,
      gross_profit: acc.gross_profit + m.gross_profit,
      gross_margin_pct: 0,
      operating_expenses: acc.operating_expenses + m.operating_expenses,
      operating_profit: acc.operating_profit + m.operating_profit,
      tax_collected: acc.tax_collected + m.tax_collected,
      order_count: acc.order_count + m.order_count,
      revenue_online: acc.revenue_online + m.revenue_online,
      revenue_business: acc.revenue_business + m.revenue_business,
      revenue_cash_sale: acc.revenue_cash_sale + m.revenue_cash_sale,
      revenue_offline: acc.revenue_offline + m.revenue_offline,
    }),
    zero
  )
  totals.gross_margin_pct = totals.net_revenue > 0 ? round2((totals.gross_profit / totals.net_revenue) * 100) : 0

  return { monthly, totals }
}

export async function getCashflow(from: string, to: string): Promise<{ monthly: CashflowMonth[] }> {
  const toTs = to + ' 23:59:59'

  const [inRows, poRows, refundRows] = await Promise.all([
    // Cash in: paid active orders + cash sales, by source
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', COALESCE(o.invoice_date, o.created_at)), 'YYYY-MM') AS month,
        o.source,
        COALESCE(SUM(o.total_amount), 0) AS amount
      FROM orders o
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
        AND COALESCE(o.invoice_date, o.created_at) >= $1
        AND COALESCE(o.invoice_date, o.created_at) <= $2
      GROUP BY 1, 2

      UNION ALL

      SELECT
        TO_CHAR(DATE_TRUNC('month', cs.created_at), 'YYYY-MM') AS month,
        'cash_sale' AS source,
        COALESCE(SUM(cs.total_amount), 0)
      FROM cash_sales cs
      WHERE cs.payment_status = 'paid'
        AND cs.created_at >= $1 AND cs.created_at <= $2
      GROUP BY 1, 2
    `,
      [from, toTs]
    ),

    // Cash out: PO / supplier bill payments
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', ep.payment_date::timestamp), 'YYYY-MM') AS month,
        COALESCE(SUM(ep.amount), 0) AS po_payments
      FROM expense_payments ep
      WHERE ep.payment_date >= $1::date AND ep.payment_date <= $2::date
      GROUP BY 1
    `,
      [from, to]
    ),

    // Cash out: refunds for cancelled/returned paid orders
    queryMany<any>(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', o.updated_at), 'YYYY-MM') AS month,
        COALESCE(SUM(o.total_amount), 0) AS refunds_out
      FROM orders o
      WHERE o.status IN ('cancelled', 'returned')
        AND o.payment_status = 'paid'
        AND o.updated_at >= $1 AND o.updated_at <= $2
      GROUP BY 1
    `,
      [from, toTs]
    ),
  ])

  const monthMap: Record<string, CashflowMonth> = {}
  const ensure = (m: string) => {
    if (!monthMap[m]) {
      monthMap[m] = {
        month: m,
        cash_in: 0,
        cash_in_online: 0,
        cash_in_business: 0,
        cash_in_cash_sale: 0,
        cash_in_offline: 0,
        po_payments: 0,
        refunds_out: 0,
        cash_out: 0,
        net: 0,
        running_balance: 0,
      }
    }
    return monthMap[m]
  }

  for (const r of inRows || []) {
    const row = ensure(r.month)
    const amt = parseFloat(r.amount)
    row.cash_in += amt
    if (r.source === 'online') row.cash_in_online += amt
    else if (r.source === 'business') row.cash_in_business += amt
    else if (r.source === 'cash_sale') row.cash_in_cash_sale += amt
    else row.cash_in_offline += amt
  }

  for (const r of poRows || []) {
    ensure(r.month).po_payments += parseFloat(r.po_payments)
  }

  for (const r of refundRows || []) {
    ensure(r.month).refunds_out += parseFloat(r.refunds_out)
  }

  let running = 0
  const monthly = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(row => {
      row.cash_out = row.po_payments + row.refunds_out
      row.net = row.cash_in - row.cash_out
      running += row.net
      row.running_balance = round2(running)
      return row
    })

  return { monthly }
}

export async function getCustomerCreditStatus(userId: string): Promise<CustomerCreditStatus> {
  const [profile, outstanding] = await Promise.all([
    queryOne<{ credit_limit: string }>(
      `
      SELECT credit_limit FROM customer_profiles WHERE user_id = $1
    `,
      [userId]
    ),
    queryOne<{ outstanding: string }>(
      `
      SELECT COALESCE(SUM(total_amount), 0) AS outstanding
      FROM orders
      WHERE user_id = $1 AND payment_status IN ('unpaid', 'partial')
    `,
      [userId]
    ),
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
