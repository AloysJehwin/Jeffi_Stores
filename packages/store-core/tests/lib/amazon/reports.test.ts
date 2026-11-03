import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), getClient: vi.fn() }))

import { mapSalesTraffic, parseSettlement } from '@/lib/amazon/reports'

describe('Amazon reports', () => {
  it('maps sales and traffic by day and by child ASIN', () => {
    const r = mapSalesTraffic({
      salesAndTrafficByDate: [
        { date: '2026-10-10', salesByDate: { orderedProductSales: { amount: 1500.5 }, unitsOrdered: 3, totalOrderItems: 2, unitsRefunded: 0 }, trafficByDate: { sessions: 40, pageViews: 55, buyBoxPercentage: 92.5, unitSessionPercentage: 7.5 } },
      ],
      salesAndTrafficByAsin: [{ childAsin: 'B0X', sku: 'SKU1', salesByAsin: { orderedProductSales: { amount: 900 }, unitsOrdered: 2 }, trafficByAsin: { sessions: 10, pageViews: 12 } }, { salesByAsin: {} }],
    })
    expect(r.daily).toEqual([['2026-10-10', 1500.5, 3, 2, 0, 40, 55, 92.5, 7.5]])
    expect(r.byAsin).toEqual([{ asin: 'B0X', sku: 'SKU1', sales: 900, units: 2, sessions: 10, pageViews: 12, buyBox: null, unitSession: null }])
  })

  it('sums a settlement into sales, fees, refunds and TCS/TDS', () => {
    const head = ['settlement-id', 'settlement-start-date', 'settlement-end-date', 'deposit-date', 'total-amount', 'currency', 'transaction-type', 'amount-type', 'amount-description', 'amount'].join('\t')
    const row = (...v: string[]) => v.join('\t')
    const tsv = [
      head,
      row('S1', '2026-10-01', '2026-10-08', '2026-10-10', '1450.00', 'INR', '', '', '', ''),
      row('S1', '', '', '', '', '', 'Order', 'ItemPrice', 'Principal', '1500'),
      row('S1', '', '', '', '', '', 'Order', 'ItemPrice', 'Tax', '270'),
      row('S1', '', '', '', '', '', 'Order', 'ItemFees', 'Commission', '-180'),
      row('S1', '', '', '', '', '', 'Order', 'ItemWithheldTax', 'TCS-IGST', '-15'),
      row('S1', '', '', '', '', '', 'Refund', 'ItemPrice', 'Principal', '-125'),
    ].join('\n')
    expect(parseSettlement(tsv)).toMatchObject({ settlementId: 'S1', total: 1450, productSales: 1770, fees: -180, taxWithheld: -15, refunds: -125, other: 0 })
    expect(parseSettlement('')).toBeNull()
  })
})
