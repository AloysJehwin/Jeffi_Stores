import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'

const db = vi.hoisted(() => ({ calls: [] as { sql: string; params: any[] }[], matched: 1 }))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(async (fn: any) =>
    fn({
      query: vi.fn(async (sql: string, params: any[] = []) => {
        db.calls.push({ sql, params })
        if (sql.includes('INSERT INTO marketplace_settlements')) return { rows: [{ id: `s-${params[1]}` }] }
        if (sql.includes('INSERT INTO marketplace_settlement_lines')) return { rows: [{ matched: String(db.matched) }] }
        return { rows: [] }
      }),
    })
  ),
}))
vi.mock('@/lib/google-ads/notify', () => ({ readSetting: vi.fn(async () => null), writeSettings: vi.fn(async () => {}) }))

import { readSheet } from '@/lib/marketplace/sheet'
import {
  classifyLine,
  fileRef,
  groupPayouts,
  importSettlementLines,
  mappingErrors,
  normalizeSettlementRows,
  suggestSettlementColumns,
  type SettlementMapping,
} from '@/lib/marketplace/settlements'

// A Myntra-style payment report: a title line, Indian-format amounts, two fee columns and a total row.
function report(): Buffer {
  const aoa = [
    ['Myntra Seller Payment Report'],
    ['UTR No', 'Settlement Date', 'Order Release ID', 'Order Line ID', 'Transaction Type', 'Customer Paid Amount', 'Commission', 'Logistics Fee', 'Fixed Fee', 'TCS', 'Net Settlement Amount'],
    ['UTR001', '05-11-2026', 'MYN-1', 'L-1', 'Forward', '₹1,299.00', '(195.00)', '70', '20', '11.0', '1,003.00'],
    ['UTR001', '05-11-2026', 'MYN-2', 'L-2', 'Customer Return', '-499', '0', '35', '0', '0', '-534'],
    ['UTR002', '12-Nov-2026', 'MYN-3', 'L-3', 'Forward', '799', '120', '70', '20', '6.5', null],
    ['UTR002', '12-Nov-2026', 'MYN-4', 'L-4', 'Forward', null, null, null, null, null, null],
    ['Total', null, null, null, null, '1,599', '315', '175', '40', '17.5', '469'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Payments')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

beforeEach(() => {
  db.calls = []
  db.matched = 1
})

describe('suggestSettlementColumns', () => {
  it('maps Myntra headers to settlement fields', () => {
    const { headers } = readSheet(report())
    const m = suggestSettlementColumns('myntra', headers)
    expect(m).toMatchObject({
      settlement_ref: 'UTR No',
      settled_on: 'Settlement Date',
      order_id: 'Order Release ID',
      line_id: 'Order Line ID',
      line_type: 'Transaction Type',
      gross: 'Customer Paid Amount',
      commission: 'Commission',
      tax_withheld: 'TCS',
      net: 'Net Settlement Amount',
    })
    expect(m.fees).toBe('Logistics Fee')
  })

  it('knows AJIO order numbers', () => {
    expect(suggestSettlementColumns('ajio', ['Cust Order No', 'Shipment ID', 'Net Payable']).order_id).toBe('Cust Order No')
  })
})

describe('mappingErrors', () => {
  it('needs an amount and only columns in the file', () => {
    expect(mappingErrors({ order_id: 'Order' }, ['Order'])).toEqual(['Map the net settled amount or the sale amount.'])
    expect(mappingErrors({ net: 'Net', fees: ['Fee A', 'Fee B'] }, ['Net', 'Fee A'])[0]).toMatch(/Fee B/)
    expect(mappingErrors({ net: 'Net' }, ['Net'])).toEqual([])
  })
})

describe('classifyLine', () => {
  it('reads the transaction text first, then the signs', () => {
    expect(classifyLine('Customer Return', -499, -534, true)).toBe('refund')
    expect(classifyLine('Commission reversal', 0, 50, false)).toBe('refund')
    expect(classifyLine('TCS deducted', 0, -10, false)).toBe('tax')
    expect(classifyLine('Shipping charges', 0, -70, true)).toBe('fee')
    expect(classifyLine(null, 0, -70, true)).toBe('fee')
    expect(classifyLine(null, -100, -100, false)).toBe('refund')
    expect(classifyLine(null, 0, 0, false)).toBe('other')
    expect(classifyLine('Forward', 1299, 1003, true)).toBe('sale')
  })
})

describe('normalizeSettlementRows', () => {
  const mapping: SettlementMapping = {
    settlement_ref: 'UTR No',
    settled_on: 'Settlement Date',
    order_id: 'Order Release ID',
    line_id: 'Order Line ID',
    line_type: 'Transaction Type',
    gross: 'Customer Paid Amount',
    commission: 'Commission',
    fees: ['Logistics Fee', 'Fixed Fee'],
    tax_withheld: 'TCS',
    net: 'Net Settlement Amount',
  }

  it('parses amounts and dates, sums fee columns, works out a missing net and skips totals', () => {
    const buf = report()
    const { lines, errors } = normalizeSettlementRows(readSheet(buf), mapping, fileRef(buf))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ settlementRef: 'UTR001', externalOrderId: 'MYN-1', externalLineId: 'L-1', lineType: 'sale', gross: 1299, commission: 195, fees: 90, taxWithheld: 11, net: 1003, postedOn: '2026-11-05' })
    expect(lines[1]).toMatchObject({ lineType: 'refund', gross: -499, fees: 35, net: -534 })
    expect(lines[2]).toMatchObject({ settlementRef: 'UTR002', postedOn: '2026-11-12', net: 799 - 120 - 90 - 6.5 })
    expect(errors).toEqual([{ row: expect.any(Number), message: 'No amount for order MYN-4' }])
  })

  it('groups lines into payouts by reference', () => {
    const buf = report()
    const { lines } = normalizeSettlementRows(readSheet(buf), mapping, fileRef(buf))
    const [a, b] = groupPayouts(lines)
    expect(a).toMatchObject({ ref: 'UTR001', lines: 2, gross: 1299, refunds: 499, commission: 195, fees: 125, taxWithheld: 11, net: 469, periodStart: '2026-11-05', periodEnd: '2026-11-05' })
    expect(b).toMatchObject({ ref: 'UTR002', lines: 1, gross: 799, net: 582.5 })
  })

  it('names payouts by file and date when the report has no reference', () => {
    const buf = report()
    const { settlement_ref, ...rest } = mapping
    void settlement_ref
    const { lines } = normalizeSettlementRows(readSheet(buf), rest, fileRef(buf))
    expect(lines[0].settlementRef).toMatch(/^UPLOAD-[0-9a-f]{10}-2026-11-05$/)
    expect(lines[2].settlementRef).toMatch(/-2026-11-12$/)
    expect(fileRef(buf)(null)).toBe(fileRef(Buffer.from(buf))(null))
  })
})

describe('importSettlementLines', () => {
  it('upserts each payout, replaces its lines and counts matched orders', async () => {
    const buf = report()
    const { lines } = normalizeSettlementRows(
      readSheet(buf),
      { settlement_ref: 'UTR No', order_id: 'Order Release ID', gross: 'Customer Paid Amount', net: 'Net Settlement Amount', settled_on: 'Settlement Date' },
      fileRef(buf)
    )
    const out = await importSettlementLines('myntra', lines, { fileName: 'payments.xlsx', source: 'upload' })
    expect(out).toEqual({ settlements: 2, lines: 3, matched: 2 })
    const upserts = db.calls.filter(c => c.sql.includes('INSERT INTO marketplace_settlements'))
    expect(upserts.map(c => c.params[1])).toEqual(['UTR001', 'UTR002'])
    expect(upserts[0].params[12]).toBe('payments.xlsx')
    const deletes = db.calls.filter(c => c.sql.startsWith('DELETE FROM marketplace_settlement_lines'))
    expect(deletes.map(c => c.params[0])).toEqual(['s-UTR001', 's-UTR002'])
    const inserted = JSON.parse(db.calls.find(c => c.sql.includes('INSERT INTO marketplace_settlement_lines'))!.params[2])
    expect(inserted.map((l: any) => l.order_id)).toEqual(['MYN-1', 'MYN-2'])
  })
})
