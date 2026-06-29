import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { OPERATIONS_TOOLS } from '@/lib/admin-agent/tools/operations'
import * as db from '@/lib/db'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)

function getTool(name: string) {
  return OPERATIONS_TOOLS.find(t => t.name === name)!
}

describe('admin-agent/tools/operations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('OPERATIONS_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(OPERATIONS_TOOLS)).toBe(true)
      expect(OPERATIONS_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of OPERATIONS_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  describe('list_pending_pickups', () => {
    it('returns pending pickup list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'pk1', order_id: 'o1', status: 'pending' }])
      const result = await getTool('list_pending_pickups').handler({})
      expect((result as any).orders).toBeDefined()
      expect((result as any).count).toBe(1)
    })
  })

  describe('list_recent_pickups', () => {
    it('returns recent pickups', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'pk2', status: 'shipped' }])
      const result = await getTool('list_recent_pickups').handler({})
      expect((result as any).pickups).toBeDefined()
      expect((result as any).count).toBe(1)
    })

    it('accepts limit parameter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_recent_pickups').handler({ limit: 5 })
      expect((result as any).pickups).toBeDefined()
      expect((result as any).count).toBe(0)
    })
  })

  describe('list_payables', () => {
    it('returns payables list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'pay1', total_amount: '5000', paid_amount: '0', days_overdue: null }])
      const result = await getTool('list_payables').handler({})
      expect((result as any).payables).toBeDefined()
      expect((result as any).count).toBe(1)
    })
  })

  describe('list_receivables', () => {
    it('returns receivables list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'rec1', total_amount: '2000', aging_bucket: '0-30' }])
      const result = await getTool('list_receivables').handler({})
      expect((result as any).receivables).toBeDefined()
      expect((result as any).count).toBe(1)
    })
  })

  describe('get_cashflow_summary', () => {
    it('returns cashflow summary for current window', async () => {
      // source calls queryOne twice: inflow then outflow
      mockQueryOne
        .mockResolvedValueOnce({ amt: '100000', cnt: 5 })
        .mockResolvedValueOnce({ amt: '60000', cnt: 3 })
      const result = await getTool('get_cashflow_summary').handler({})
      expect((result as any).receipts).toBeDefined()
      expect((result as any).payments).toBeDefined()
      expect((result as any).net).toBe(40000)
    })

    it('accepts daysBack parameter', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ amt: '80000', cnt: 4 })
        .mockResolvedValueOnce({ amt: '50000', cnt: 2 })
      const result = await getTool('get_cashflow_summary').handler({ daysBack: 7 })
      expect((result as any).window_days).toBe(7)
    })

    it('handles missing data gracefully', async () => {
      mockQueryOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
      const result = await getTool('get_cashflow_summary').handler({})
      expect(typeof (result as any).net).toBe('number')
    })
  })

  describe('get_pl_summary', () => {
    it('returns P&L summary', async () => {
      mockQueryOne.mockResolvedValueOnce({ revenue: '200000', cogs: '120000', tax: '0', orders: 10 })
      const result = await getTool('get_pl_summary').handler({})
      expect((result as any).revenue).toBe(200000)
      expect((result as any).gross_profit).toBe(80000)
    })

    it('accepts month parameter', async () => {
      mockQueryOne.mockResolvedValueOnce({ revenue: '150000', cogs: '90000', tax: '0', orders: 8 })
      const result = await getTool('get_pl_summary').handler({ month: '2024-10' })
      expect((result as any).month).toBe('2024-10')
    })
  })

  describe('get_gst_summary', () => {
    it('returns GST summary', async () => {
      // source calls queryOne twice: output GST then input ITC
      mockQueryOne
        .mockResolvedValueOnce({ taxable: '100000', cgst: '9000', sgst: '9000', igst: '0', invoices: 5 })
        .mockResolvedValueOnce({ taxable: '50000', tax: '4500', lines: 3 })
      const result = await getTool('get_gst_summary').handler({})
      expect((result as any).output).toBeDefined()
      expect((result as any).input_itc).toBeDefined()
      expect((result as any).net_tax_payable).toBeDefined()
    })
  })

  describe('list_recent_transactions', () => {
    it('returns recent transactions', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'txn1', amount: '500', direction: 'inflow' }])
      const result = await getTool('list_recent_transactions').handler({})
      expect((result as any).transactions).toBeDefined()
      expect((result as any).count).toBe(1)
    })

    it('accepts limit', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_recent_transactions').handler({ limit: 10 })
      expect((result as any).transactions).toBeDefined()
      expect((result as any).count).toBe(0)
    })
  })

  describe('propose_create_pickup_request', () => {
    it('proposes pickup creation for valid orders', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'o1', order_number: 'ORD-001', awb_number: 'AWB123', customer_name: 'Test', total_amount: '1000', status: 'confirmed' },
      ])
      const result = await getTool('propose_create_pickup_request').handler({
        orderIds: ['o1'],
        pickupDate: '2024-12-25',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('create_pickup_request')
    })

    it('returns proposed false when no eligible orders found', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('propose_create_pickup_request').handler({
        orderIds: ['bad-id'],
        pickupDate: '2024-12-25',
      })
      expect((result as any).proposed).toBe(false)
    })

    it('throws when orderIds is missing or empty', async () => {
      await expect(
        getTool('propose_create_pickup_request').handler({ orderIds: [], pickupDate: '2024-12-25' })
      ).rejects.toThrow()
    })

    // Line 308 branch: eligible.length !== ids.length (partial eligibility)
    it('returns proposed false with eligibleCount when only some orders qualify', async () => {
      // 2 ids requested but only 1 comes back eligible
      mockQueryMany.mockResolvedValueOnce([
        { id: 'o1', order_number: 'ORD-001', awb_number: 'AWB123', customer_name: 'Test', total_amount: '1000', status: 'confirmed' },
      ])
      const result = await getTool('propose_create_pickup_request').handler({
        orderIds: ['o1', 'o2'],
        pickupDate: '2024-12-25',
      })
      expect((result as any).proposed).toBe(false)
      expect((result as any).eligibleCount).toBe(1)
    })

    it('uses tomorrow as pickupDate when not supplied', async () => {
      mockQueryMany.mockResolvedValueOnce([
        { id: 'o1', order_number: 'ORD-001', awb_number: 'AWB123', customer_name: 'Test', total_amount: '500', status: 'confirmed' },
      ])
      const result = await getTool('propose_create_pickup_request').handler({
        orderIds: ['o1'],
      })
      expect((result as any).proposed).toBe(true)
      // pickupDate in payload should be a YYYY-MM-DD string
      expect((result as any).payload.pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('throws when pickupDate is not YYYY-MM-DD', async () => {
      await expect(
        getTool('propose_create_pickup_request').handler({
          orderIds: ['o1'],
          pickupDate: '25-12-2024',
        })
      ).rejects.toThrow('pickupDate must be YYYY-MM-DD')
    })
  })

  describe('propose_sync_delhivery_statuses', () => {
    it('proposes delhivery status sync when open AWBs exist', async () => {
      // source calls queryOne twice: open forward AWBs then RVP
      mockQueryOne
        .mockResolvedValueOnce({ n: 5 })
        .mockResolvedValueOnce({ n: 2 })
      const result = await getTool('propose_sync_delhivery_statuses').handler({})
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBeDefined()
    })

    it('returns proposed false when no open AWBs', async () => {
      mockQueryOne
        .mockResolvedValueOnce({ n: 0 })
        .mockResolvedValueOnce({ n: 0 })
      const result = await getTool('propose_sync_delhivery_statuses').handler({})
      expect((result as any).proposed).toBe(false)
    })
  })

  describe('propose_pay_payable', () => {
    it('proposes payment for valid payable', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay1',
        expense_number: 'EXP-001',
        supplier_name: 'Acme',
        total_amount: '10000',
        status: 'pending',
        paid_amount: '0',
      })
      const result = await getTool('propose_pay_payable').handler({
        payableId: 'pay1',
        paymentMode: 'bank_transfer',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('pay_payable')
    })

    it('includes high-value warning in ui_blocks for payout > 50000', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay2',
        expense_number: 'EXP-002',
        supplier_name: 'BigVendor',
        total_amount: '75000',
        status: 'pending',
        paid_amount: '0',
      })
      const result = await getTool('propose_pay_payable').handler({
        payableId: 'pay2',
        paymentMode: 'bank_transfer',
      })
      expect((result as any).proposed).toBe(true)
      const blocks = (result as any).ui_blocks as any[]
      const warning = blocks.find((b: any) => b.tone === 'warn')
      expect(warning).toBeDefined()
    })

    it('throws when payable not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_pay_payable').handler({
          payableId: 'bad',
          paymentMode: 'cash',
        })
      ).rejects.toThrow()
    })

    // Line 526: exp.status === 'paid' — already fully paid branch
    it('returns proposed false when payable is already fully paid', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay3',
        expense_number: 'EXP-003',
        supplier_name: 'Vendor',
        total_amount: '5000',
        status: 'paid',
        paid_amount: '5000',
      })
      const result = await getTool('propose_pay_payable').handler({
        payableId: 'pay3',
        paymentMode: 'upi',
      })
      expect((result as any).proposed).toBe(false)
      expect((result as any).info).toContain('already fully paid')
    })

    // Lines 531-534: custom amount string supplied — valid partial payment
    it('accepts a custom partial amount when provided as a string', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay4',
        expense_number: 'EXP-004',
        supplier_name: 'PartialVendor',
        total_amount: '10000',
        status: 'partial',
        paid_amount: '4000',
      })
      const result = await getTool('propose_pay_payable').handler({
        payableId: 'pay4',
        paymentMode: 'upi',
        amount: '3000',
      })
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.amount).toBe(3000)
    })

    // Lines 532: amount not finite or <= 0 → throws
    it('throws when custom amount is not a positive number', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay5',
        expense_number: 'EXP-005',
        supplier_name: 'Vendor',
        total_amount: '5000',
        status: 'unpaid',
        paid_amount: '0',
      })
      await expect(
        getTool('propose_pay_payable').handler({
          payableId: 'pay5',
          paymentMode: 'cash',
          amount: '-100',
        })
      ).rejects.toThrow('amount must be a positive number')
    })

    // Lines 533: amount exceeds remaining → throws
    it('throws when custom amount exceeds remaining balance', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay6',
        expense_number: 'EXP-006',
        supplier_name: 'Vendor',
        total_amount: '5000',
        status: 'unpaid',
        paid_amount: '0',
      })
      await expect(
        getTool('propose_pay_payable').handler({
          payableId: 'pay6',
          paymentMode: 'cash',
          amount: '9999',
        })
      ).rejects.toThrow('exceeds remaining')
    })

    // transactionRef path: confirmation string includes ref
    it('includes transaction reference in confirmation when provided', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'pay7',
        expense_number: 'EXP-007',
        supplier_name: 'Vendor',
        total_amount: '2000',
        status: 'unpaid',
        paid_amount: '0',
      })
      const result = await getTool('propose_pay_payable').handler({
        payableId: 'pay7',
        paymentMode: 'upi',
        transactionRef: 'UPI-REF-123',
      })
      expect((result as any).confirmation).toContain('UPI-REF-123')
    })
  })

  describe('propose_export_gstr1', () => {
    it('proposes GSTR-1 export when invoices exist', async () => {
      mockQueryOne.mockResolvedValueOnce({ rows: 10, b2b: 6, b2c: 4, total: '500000' })
      const result = await getTool('propose_export_gstr1').handler({ month: '2024-11' })
      expect((result as any).proposed).toBe(true)
      expect((result as any).kind).toBe('export_gstr1')
    })

    it('returns proposed false when no invoices for the month', async () => {
      mockQueryOne.mockResolvedValueOnce({ rows: 0, b2b: 0, b2c: 0, total: '0' })
      const result = await getTool('propose_export_gstr1').handler({ month: '2024-11' })
      expect((result as any).proposed).toBe(false)
    })

    it('uses previous month when no month given', async () => {
      mockQueryOne.mockResolvedValueOnce({ rows: 5, b2b: 3, b2c: 2, total: '250000' })
      const result = await getTool('propose_export_gstr1').handler({})
      expect((result as any).proposed).toBe(true)
    })
  })
})
