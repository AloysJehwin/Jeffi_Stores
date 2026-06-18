import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn((_search: string, _cols: string[], startIdx: number) => ({
    clause: 'TRUE',
    params: [],
    nextIdx: startIdx,
  })),
  buildVectorSearchClause: vi.fn((_search: string, _vec: string, _textCols: string[], _exactCols: string[], startIdx: number) => ({
    clause: 'TRUE',
    params: [],
    nextIdx: startIdx,
  })),
}))

import { queryOne, queryMany } from '@/lib/db'
import {
  getReceivablesAging,
  getPayables,
  getPLReport,
  getCashflow,
  getCustomerCreditStatus,
  ReceivableRow,
  PayableRow,
} from '@/lib/financial'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── getCustomerCreditStatus ───────────────────────────────────────────────────

describe('getCustomerCreditStatus', () => {
  it('returns credit status with available credit calculated', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ credit_limit: '50000' })
      .mockResolvedValueOnce({ outstanding: '15000' })

    const result = await getCustomerCreditStatus('user-1')
    expect(result.credit_limit).toBe(50000)
    expect(result.outstanding).toBe(15000)
    expect(result.available).toBe(35000)
    expect(result.is_over_limit).toBe(false)
  })

  it('is_over_limit is true when outstanding >= credit_limit', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ credit_limit: '10000' })
      .mockResolvedValueOnce({ outstanding: '10000' })

    const result = await getCustomerCreditStatus('user-2')
    expect(result.is_over_limit).toBe(true)
    expect(result.available).toBe(0)
  })

  it('is_over_limit is false when credit_limit is 0 (unlimited)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ credit_limit: '0' })
      .mockResolvedValueOnce({ outstanding: '5000' })

    const result = await getCustomerCreditStatus('user-3')
    // credit_limit=0 means "no limit set" — is_over_limit requires credit_limit > 0
    expect(result.is_over_limit).toBe(false)
  })

  it('clamps available to 0 when over limit (no negative available)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ credit_limit: '5000' })
      .mockResolvedValueOnce({ outstanding: '8000' })

    const result = await getCustomerCreditStatus('user-4')
    expect(result.available).toBe(0)
    expect(result.is_over_limit).toBe(true)
  })

  it('defaults to 0 when profile row is null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const result = await getCustomerCreditStatus('user-5')
    expect(result.credit_limit).toBe(0)
    expect(result.outstanding).toBe(0)
    expect(result.available).toBe(0)
    expect(result.is_over_limit).toBe(false)
  })
})

// ── getReceivablesAging ───────────────────────────────────────────────────────

describe('getReceivablesAging', () => {
  function makeReceivableRow(overrides: Partial<ReceivableRow> = {}): ReceivableRow {
    return {
      order_id: 'o1',
      order_number: 'ORD-001',
      invoice_number: 'INV-001',
      customer_name: 'Test Customer',
      customer_phone: '9999999999',
      invoice_date: '2026-01-01',
      total_amount: 1000,
      payment_status: 'unpaid',
      days_outstanding: 15,
      aging_bucket: '0-30',
      user_id: 'user-1',
      credit_limit: 50000,
      ...overrides,
    }
  }

  it('returns rows, summary and total', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '2' })
    mockQueryMany.mockResolvedValueOnce([
      makeReceivableRow({ total_amount: 1000, aging_bucket: '0-30' }),
      makeReceivableRow({ order_id: 'o2', total_amount: 2000, aging_bucket: '31-60' }),
    ])

    const result = await getReceivablesAging({})
    expect(result.total).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(result.summary.total).toBeCloseTo(3000, 2)
    expect(result.summary.bucket_0_30).toBeCloseTo(1000, 2)
    expect(result.summary.bucket_31_60).toBeCloseTo(2000, 2)
    expect(result.summary.bucket_60plus).toBe(0)
  })

  it('aggregates 60+ bucket correctly', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makeReceivableRow({ total_amount: 5000, aging_bucket: '60+' }),
    ])

    const result = await getReceivablesAging({})
    expect(result.summary.bucket_60plus).toBeCloseTo(5000, 2)
    expect(result.summary.bucket_0_30).toBe(0)
  })

  it('returns empty summary when no rows', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' })
    mockQueryMany.mockResolvedValueOnce([])

    const result = await getReceivablesAging({})
    expect(result.total).toBe(0)
    expect(result.rows).toHaveLength(0)
    expect(result.summary.total).toBe(0)
  })

  it('handles null count row gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])

    const result = await getReceivablesAging({})
    expect(result.total).toBe(0)
  })

  it('handles null queryMany result gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' })
    mockQueryMany.mockResolvedValueOnce(null as any)

    const result = await getReceivablesAging({})
    expect(result.rows).toHaveLength(0)
    expect(result.summary.total).toBe(0)
  })

  it('splits amounts across all three aging buckets', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '3' })
    mockQueryMany.mockResolvedValueOnce([
      makeReceivableRow({ total_amount: 100, aging_bucket: '0-30' }),
      makeReceivableRow({ total_amount: 200, aging_bucket: '31-60' }),
      makeReceivableRow({ total_amount: 400, aging_bucket: '60+' }),
    ])

    const result = await getReceivablesAging({})
    expect(result.summary.total).toBeCloseTo(700, 2)
    expect(result.summary.bucket_0_30).toBeCloseTo(100, 2)
    expect(result.summary.bucket_31_60).toBeCloseTo(200, 2)
    expect(result.summary.bucket_60plus).toBeCloseTo(400, 2)
  })

  // ── Lines 106-109: search filter in getReceivablesAging ───────────────────

  it('applies search filter — invokes buildVectorSearchClause', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makeReceivableRow({ customer_name: 'Alice', total_amount: 2500, aging_bucket: '0-30' }),
    ])

    const result = await getReceivablesAging({ search: 'Alice' })
    expect(result.total).toBe(1)
    expect(result.rows[0].customer_name).toBe('Alice')
    expect(result.summary.bucket_0_30).toBeCloseTo(2500, 2)
  })

  it('combines search with date and phone filters', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makeReceivableRow({ customer_name: 'Bob', total_amount: 1000, aging_bucket: '31-60' }),
    ])

    const result = await getReceivablesAging({
      search: 'Bob',
      from: '2026-01-01',
      to: '2026-03-31',
      customerPhone: '9876543210',
    })
    expect(result.total).toBe(1)
    expect(result.summary.bucket_31_60).toBeCloseTo(1000, 2)
  })
})

// ── getPayables ───────────────────────────────────────────────────────────────

describe('getPayables', () => {
  function makePayableRow(overrides: Partial<PayableRow> = {}): PayableRow {
    return {
      id: 'e1',
      expense_number: 'EXP-001',
      supplier_name: 'Supplier A',
      supplier_gstin: null,
      description: null,
      amount: 5000,
      tax_amount: 900,
      total_amount: 5900,
      expense_date: '2026-01-01',
      due_date: null,
      status: 'pending',
      days_overdue: null,
      paid_amount: 0,
      po_id: null,
      supplier_bank_name: null,
      supplier_account_number: null,
      supplier_ifsc: null,
      supplier_upi_id: null,
      ...overrides,
    }
  }

  it('returns rows, summary, and total count', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 5900, paid_amount: 0 }),
    ])

    const result = await getPayables({})
    expect(result.total).toBe(1)
    expect(result.rows).toHaveLength(1)
    expect(result.summary.total_payable).toBeCloseTo(5900, 2)
  })

  it('subtracts paid_amount from total_payable in summary', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 5900, paid_amount: 1000 }),
    ])

    const result = await getPayables({})
    expect(result.summary.total_payable).toBeCloseTo(4900, 2)
  })

  it('marks due_this_week correctly for future due date within 7 days', async () => {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 3) // 3 days from now
    const dueDateStr = dueDate.toISOString().split('T')[0]

    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 3000, paid_amount: 0, due_date: dueDateStr }),
    ])

    const result = await getPayables({})
    expect(result.summary.due_this_week).toBeCloseTo(3000, 2)
    expect(result.summary.overdue).toBe(0)
  })

  it('marks overdue correctly for past due dates', async () => {
    const pastDate = '2020-01-01' // clearly in the past

    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 2000, paid_amount: 500, due_date: pastDate }),
    ])

    const result = await getPayables({})
    expect(result.summary.overdue).toBeCloseTo(1500, 2)
    expect(result.summary.due_this_week).toBe(0)
  })

  it('returns empty summary for no rows', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' })
    mockQueryMany.mockResolvedValueOnce([])

    const result = await getPayables({})
    expect(result.summary.total_payable).toBe(0)
    expect(result.summary.due_this_week).toBe(0)
    expect(result.summary.overdue).toBe(0)
  })

  it('handles null rows gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '0' })
    mockQueryMany.mockResolvedValueOnce(null as any)

    const result = await getPayables({})
    expect(result.rows).toHaveLength(0)
    expect(result.summary.total_payable).toBe(0)
  })

  it('handles null countRow gracefully in getPayables', async () => {
    // Covers the countRow?.count null branch (line 226)
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])

    const result = await getPayables({})
    expect(result.total).toBe(0)
  })

  it('does not add to due_this_week or overdue when due date is more than 7 days away', async () => {
    // Covers the else-if (due <= weekFromNow) false branch (line 237)
    const farFuture = new Date()
    farFuture.setDate(farFuture.getDate() + 30) // 30 days out — beyond the 7-day window
    const dueDateStr = farFuture.toISOString().split('T')[0]

    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 4000, paid_amount: 0, due_date: dueDateStr }),
    ])

    const result = await getPayables({})
    expect(result.summary.total_payable).toBeCloseTo(4000, 2)
    expect(result.summary.due_this_week).toBe(0)
    expect(result.summary.overdue).toBe(0)
  })

  // ── Lines 183-184: status filter (specific status, not 'all') ───────────────

  it('applies specific status filter — adds e.status = $N condition', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 1200, paid_amount: 0, status: 'overdue' }),
    ])

    const result = await getPayables({ status: 'overdue' })
    expect(result.total).toBe(1)
    expect(result.rows[0].status).toBe('overdue')
    expect(result.summary.total_payable).toBeCloseTo(1200, 2)
  })

  it('does not filter by status when status is "all"', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '2' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 1000, paid_amount: 0, status: 'pending' }),
      makePayableRow({ id: 'e2', total_amount: 2000, paid_amount: 0, status: 'paid' }),
    ])

    const result = await getPayables({ status: 'all' })
    expect(result.total).toBe(2)
    expect(result.rows).toHaveLength(2)
  })

  it('applies status filter for "pending" and also applies from/to date filters', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ total_amount: 5000, paid_amount: 0, status: 'pending' }),
    ])

    const result = await getPayables({
      status: 'pending',
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(result.total).toBe(1)
    expect(result.summary.total_payable).toBeCloseTo(5000, 2)
  })

  // ── Lines 191-194: search filter (buildSearchClause branch) ─────────────────

  it('applies search filter — invokes buildSearchClause', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ supplier_name: 'Acme Corp', total_amount: 3000, paid_amount: 0 }),
    ])

    const result = await getPayables({ search: 'Acme' })
    expect(result.total).toBe(1)
    expect(result.rows[0].supplier_name).toBe('Acme Corp')
  })

  it('combines status and search filters together', async () => {
    mockQueryOne.mockResolvedValueOnce({ count: '1' })
    mockQueryMany.mockResolvedValueOnce([
      makePayableRow({ supplier_name: 'Zeta Ltd', total_amount: 7500, paid_amount: 500, status: 'overdue' }),
    ])

    const result = await getPayables({ status: 'overdue', search: 'Zeta' })
    expect(result.total).toBe(1)
    expect(result.summary.total_payable).toBeCloseTo(7000, 2)
  })
})

// ── getPLReport ───────────────────────────────────────────────────────────────

describe('getPLReport', () => {
  it('computes gross_profit and gross_margin_pct per month', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { month: '2026-01', revenue: '100000', cogs: '60000', tax_collected: '18000', order_count: 50 },
    ])

    const result = await getPLReport('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(1)
    const m = result.monthly[0]
    expect(m.month).toBe('2026-01')
    expect(m.revenue).toBe(100000)
    expect(m.cogs).toBe(60000)
    expect(m.gross_profit).toBe(40000)
    expect(m.gross_margin_pct).toBe(40) // 40000/100000 * 100
    expect(m.tax_collected).toBe(18000)
    expect(m.order_count).toBe(50)
  })

  it('computes totals as sum of all monthly rows', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { month: '2026-01', revenue: '100000', cogs: '60000', tax_collected: '18000', order_count: 50 },
      { month: '2026-02', revenue: '80000', cogs: '40000', tax_collected: '14400', order_count: 40 },
    ])

    const result = await getPLReport('2026-01-01', '2026-02-28')
    expect(result.totals.revenue).toBe(180000)
    expect(result.totals.cogs).toBe(100000)
    expect(result.totals.gross_profit).toBe(80000)
    expect(result.totals.order_count).toBe(90)
    // gross_margin_pct = 80000/180000 * 100 ≈ 44.44
    expect(result.totals.gross_margin_pct).toBeCloseTo(44.44, 1)
  })

  it('sets gross_margin_pct to 0 when revenue is 0', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { month: '2026-01', revenue: '0', cogs: '0', tax_collected: '0', order_count: 0 },
    ])

    const result = await getPLReport('2026-01-01', '2026-01-31')
    expect(result.monthly[0].gross_margin_pct).toBe(0)
    expect(result.totals.gross_margin_pct).toBe(0)
  })

  it('returns empty monthly and zero totals when no data', async () => {
    mockQueryMany.mockResolvedValueOnce([])

    const result = await getPLReport('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(0)
    expect(result.totals.revenue).toBe(0)
    expect(result.totals.gross_profit).toBe(0)
    expect(result.totals.gross_margin_pct).toBe(0)
  })

  it('handles null queryMany result in getPLReport (rows || [] branch)', async () => {
    // Covers the (rows || []).map null branch (line 283)
    mockQueryMany.mockResolvedValueOnce(null as any)

    const result = await getPLReport('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(0)
    expect(result.totals.revenue).toBe(0)
  })

  it('handles negative gross_profit (loss scenario)', async () => {
    mockQueryMany.mockResolvedValueOnce([
      { month: '2026-01', revenue: '50000', cogs: '70000', tax_collected: '9000', order_count: 20 },
    ])

    const result = await getPLReport('2026-01-01', '2026-01-31')
    expect(result.monthly[0].gross_profit).toBe(-20000)
    // negative margin
    expect(result.monthly[0].gross_margin_pct).toBeLessThan(0)
  })
})

// ── getCashflow ───────────────────────────────────────────────────────────────

describe('getCashflow', () => {
  it('computes net and running_balance per month', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ month: '2026-01', cash_in: '100000' }])
      .mockResolvedValueOnce([{ month: '2026-01', cash_out: '40000' }])

    const result = await getCashflow('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(1)
    const m = result.monthly[0]
    expect(m.cash_in).toBe(100000)
    expect(m.cash_out).toBe(40000)
    expect(m.net).toBe(60000)
    expect(m.running_balance).toBe(60000)
  })

  it('accumulates running_balance across months', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { month: '2026-01', cash_in: '100000' },
        { month: '2026-02', cash_in: '80000' },
      ])
      .mockResolvedValueOnce([
        { month: '2026-01', cash_out: '60000' },
        { month: '2026-02', cash_out: '30000' },
      ])

    const result = await getCashflow('2026-01-01', '2026-02-28')
    expect(result.monthly).toHaveLength(2)
    expect(result.monthly[0].running_balance).toBe(40000)   // 100000 - 60000
    expect(result.monthly[1].running_balance).toBe(90000)   // 40000 + (80000 - 30000)
  })

  it('handles months with only cash_in (no cash_out)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ month: '2026-03', cash_in: '50000' }])
      .mockResolvedValueOnce([]) // no outflows

    const result = await getCashflow('2026-03-01', '2026-03-31')
    expect(result.monthly[0].cash_out).toBe(0)
    expect(result.monthly[0].net).toBe(50000)
  })

  it('handles months with only cash_out (no cash_in)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([]) // no inflows
      .mockResolvedValueOnce([{ month: '2026-03', cash_out: '20000' }])

    const result = await getCashflow('2026-03-01', '2026-03-31')
    expect(result.monthly[0].cash_in).toBe(0)
    expect(result.monthly[0].net).toBe(-20000)
    expect(result.monthly[0].running_balance).toBe(-20000)
  })

  it('returns empty monthly array when no data', async () => {
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await getCashflow('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(0)
  })

  it('handles null queryMany results gracefully', async () => {
    mockQueryMany
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce(null as any)

    const result = await getCashflow('2026-01-01', '2026-01-31')
    expect(result.monthly).toHaveLength(0)
  })

  it('rounds running_balance to 2 decimal places', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ month: '2026-01', cash_in: '1000.333' }])
      .mockResolvedValueOnce([{ month: '2026-01', cash_out: '333.333' }])

    const result = await getCashflow('2026-01-01', '2026-01-31')
    // running_balance = Math.round((1000.333 - 333.333) * 100) / 100 = 667
    expect(result.monthly[0].running_balance).toBe(667)
  })
})
