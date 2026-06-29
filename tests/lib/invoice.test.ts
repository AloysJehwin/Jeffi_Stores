import { describe, it, expect, vi, beforeEach } from 'vitest'

// isGSTEnabled is captured at module load time in invoice.ts.
// vi.hoisted runs before module resolution, ensuring the env var is set when
// @/lib/invoice is first imported.
vi.hoisted(() => {
  process.env.ENABLE_GST = 'true'
  process.env.BUSINESS_STATE_CODE = '22'
})

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  getFinancialYear: vi.fn().mockReturnValue('2024-25'),
  generateInvoiceNumber: vi.fn().mockReturnValue('JS/2024-25/0001'),
  getNextInvoiceSequence: vi.fn().mockResolvedValue(1),
  isInterState: vi.fn().mockReturnValue(false),
  calculateGST: vi.fn().mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0, totalTax: 15.26 }),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/lib/invoice-pdf', () => ({
  generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('mock-invoice-pdf')),
}))

vi.mock('@/lib/s3', () => ({
  uploadInvoicePDF: vi.fn().mockResolvedValue('https://s3.example.com/invoices/JS-2024-25-0001.pdf'),
}))

import { createDraftInvoice, generateOrderInvoice } from '@/lib/invoice'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { generateInvoicePDF } from '@/lib/invoice-pdf'
import { uploadInvoicePDF } from '@/lib/s3'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence, isInterState, calculateGST } from '@/lib/gst'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTransaction = vi.mocked(withTransaction)
const mockGenerateInvoicePDF = vi.mocked(generateInvoicePDF)
const mockUploadInvoicePDF = vi.mocked(uploadInvoicePDF)
const mockGetFinancialYear = vi.mocked(getFinancialYear)
const mockGenerateInvoiceNumber = vi.mocked(generateInvoiceNumber)
const mockIsInterState = vi.mocked(isInterState)
const mockCalculateGST = vi.mocked(calculateGST)

const mockOrder = {
  id: 'order-1',
  order_number: 'ON-001',
  customer_name: 'John Doe',
  customer_phone: '9876543210',
  payment_status: 'paid',
  status: 'confirmed',
  original_order_id: null,
  subtotal: '100.00',
  tax_amount: '18.00',
  total_amount: '118.00',
  discount_amount: '0',
  shipping_amount: '0',
  taxable_amount: '0',
  cgst_amount: '0',
  sgst_amount: '0',
  igst_amount: '0',
  is_igst: false,
  buyer_gstin: null,
  created_at: '2024-01-15T10:00:00Z',
  tracking_number: null,
  shipped_at: null,
  shipping_method: null,
  city: 'Raipur',
  state: 'Chhattisgarh',
  postal_code: '492001',
  full_name: 'John Doe',
  address_line1: '123 Main St',
  address_line2: null,
  address_phone: '9876543210',
  billing_address_id: null,
  shipping_address_id: 'addr-1',
  irn: null,
  irn_ack_no: null,
  irn_ack_dt: null,
  signed_qr: null,
  payment_link_url: null,
  eway_bill_no: null,
}

const mockOrderItem = {
  id: 'item-1',
  order_id: 'order-1',
  product_name: 'M6 Bolt',
  hsn_code: '73181500',
  gst_rate: '18',
  quantity: 2,
  unit_price: '50.00',
  total_price: '100.00',
  taxable_amount: '84.75',
  cgst_amount: '7.63',
  sgst_amount: '7.63',
  igst_amount: '0',
  buy_mode: 'unit',
  buy_unit: null,
  created_at: '2024-01-15T10:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// createDraftInvoice
// ---------------------------------------------------------------------------
describe('createDraftInvoice', () => {
  it('does nothing when invoice already exists', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-inv' })
    await createDraftInvoice('order-1')
    expect(mockQueryOne).toHaveBeenCalledOnce()
  })

  it('inserts draft invoice when none exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)           // SELECT — no existing
      .mockResolvedValueOnce({ id: 'new-inv' }) // INSERT RETURNING
    await createDraftInvoice('order-1')
    expect(mockQueryOne).toHaveBeenCalledTimes(2)
    const [insertSql] = mockQueryOne.mock.calls[1]
    expect(insertSql).toContain("'draft'")
  })

  it('inserts with the correct order_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'inv-2' })
    await createDraftInvoice('order-xyz')
    const [, params] = mockQueryOne.mock.calls[1]
    expect(params).toContain('order-xyz')
  })
})

// ---------------------------------------------------------------------------
// generateOrderInvoice — already finalized (covers the early-return guard path)
// ---------------------------------------------------------------------------
describe('generateOrderInvoice already finalized', () => {
  it('returns null when invoice already finalized', async () => {
    process.env.ENABLE_GST = 'true'
    mockQueryOne.mockResolvedValueOnce({ id: 'existing-finalized' })
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// generateOrderInvoice — various guard conditions
// ---------------------------------------------------------------------------
describe('generateOrderInvoice guard conditions', () => {
  beforeEach(() => {
    mockQueryOne
      .mockResolvedValueOnce(null)   // no existing finalized invoice
  })

  it('returns null when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)  // order query
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })

  it('returns null for replacement/return order (original_order_id set)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...mockOrder, original_order_id: 'order-0' })
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })

  it('returns null when payment_status is not paid', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...mockOrder, payment_status: 'pending' })
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })

  it('returns null when order status is pending', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...mockOrder, status: 'pending' })
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })

  it('returns null when order status is cancelled', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...mockOrder, status: 'cancelled' })
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// generateOrderInvoice — success path
// ---------------------------------------------------------------------------
describe('generateOrderInvoice success path', () => {
  function setupSuccessPath() {
    // 1) no existing finalized invoice
    // 2) order with address
    // 3) order items
    // then withTransaction executes the callback
    // 4) settings rows
    // 5) updated items
    // 6) no billing address (billing_address_id is null)
    // 7) update pdf_url

    mockQueryOne
      .mockResolvedValueOnce(null)           // no finalized invoice
      .mockResolvedValueOnce(mockOrder)      // fetch order
      .mockResolvedValueOnce(null)           // billing address not fetched (billing_address_id null)
      .mockResolvedValueOnce({ id: 'inv-updated' })  // UPDATE pdf_url

    mockQueryMany
      .mockResolvedValueOnce([mockOrderItem]) // order items in generateOrderInvoice
      .mockResolvedValueOnce([               // settings rows
        { key: 'business_gstin', value: '22AAAAA0000A1Z5' },
        { key: 'business_legal_name', value: 'Jeffi Stores' },
        { key: 'business_trade_name', value: 'Jeffi Stores' },
        { key: 'business_address', value: '123 Main, Raipur' },
        { key: 'business_state', value: 'Chhattisgarh' },
        { key: 'business_state_code', value: '22' },
        { key: 'business_phone', value: '+91 98765 43210' },
        { key: 'business_email', value: 'jeffi@example.com' },
      ])
      .mockResolvedValueOnce([mockOrderItem]) // updated items

    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          rows: [{ value: 'JS' }],
          rowCount: 1,
        }),
      }
      return fn(mockClient as any)
    })

    mockGetFinancialYear.mockReturnValue('2024-25')
    mockGenerateInvoiceNumber.mockReturnValue('JS/2024-25/0001')
    mockIsInterState.mockReturnValue(false)
    mockCalculateGST.mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0, totalTax: 15.26 })
    mockGenerateInvoicePDF.mockResolvedValue(Buffer.from('pdf-content'))
    mockUploadInvoicePDF.mockResolvedValue('https://s3.example.com/JS-0001.pdf')
  }

  it('returns a Buffer on success', async () => {
    setupSuccessPath()
    const result = await generateOrderInvoice('order-1')
    expect(result).toBeInstanceOf(Buffer)
    expect(result?.toString()).toBe('pdf-content')
  })

  it('calls generateInvoicePDF with correct invoice number', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    expect(mockGenerateInvoicePDF).toHaveBeenCalledOnce()
    const [invoiceOrder] = mockGenerateInvoicePDF.mock.calls[0]
    expect(invoiceOrder.invoice_number).toBe('JS/2024-25/0001')
  })

  it('calls uploadInvoicePDF with pdf buffer and invoice number', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    expect(mockUploadInvoicePDF).toHaveBeenCalledOnce()
    const [buf, invoiceNum, fy] = mockUploadInvoicePDF.mock.calls[0]
    expect(buf).toBeInstanceOf(Buffer)
    expect(invoiceNum).toBe('JS/2024-25/0001')
    expect(fy).toBe('2024-25')
  })

  it('calls withTransaction to atomically assign invoice number', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    expect(mockWithTransaction).toHaveBeenCalledOnce()
  })

  it('maps order items into InvoiceOrderItem format', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    const [, invoiceItems] = mockGenerateInvoicePDF.mock.calls[0]
    expect(Array.isArray(invoiceItems)).toBe(true)
    expect(invoiceItems[0]).toMatchObject({
      product_name: 'M6 Bolt',
      quantity: 2,
    })
  })

  it('includes buyer address in generateInvoicePDF call', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    const [, , , buyerAddress] = mockGenerateInvoicePDF.mock.calls[0]
    expect(buyerAddress).toMatchObject({
      full_name: 'John Doe',
      city: 'Raipur',
      state: 'Chhattisgarh',
    })
  })

  it('calculates GST when taxableAmount is 0 but tax_amount > 0', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    expect(mockCalculateGST).toHaveBeenCalled()
  })

  it('updates pdf_url on invoices table after upload', async () => {
    setupSuccessPath()
    await generateOrderInvoice('order-1')
    // Last queryOne call should be the UPDATE pdf_url
    const lastCall = mockQueryOne.mock.calls[mockQueryOne.mock.calls.length - 1]
    expect(lastCall[0]).toContain('pdf_url')
    expect(lastCall[1]).toContain('https://s3.example.com/JS-0001.pdf')
  })
})

// ---------------------------------------------------------------------------
// generateOrderInvoice — with billing address
// ---------------------------------------------------------------------------
describe('generateOrderInvoice with separate billing address', () => {
  it('fetches billing address when billing_address_id differs from shipping_address_id', async () => {
    const orderWithBilling = {
      ...mockOrder,
      billing_address_id: 'addr-2',
      shipping_address_id: 'addr-1',
    }

    mockQueryOne
      .mockResolvedValueOnce(null)              // no finalized invoice
      .mockResolvedValueOnce(orderWithBilling)  // order
      .mockResolvedValueOnce({                  // billing address
        full_name: 'Jane Doe',
        address_line1: '456 Business Rd',
        address_line2: null,
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400001',
        phone: '9123456789',
      })
      .mockResolvedValueOnce({ id: 'inv-up' })  // UPDATE pdf_url

    mockQueryMany
      .mockResolvedValueOnce([mockOrderItem])   // order items
      .mockResolvedValueOnce([{ key: 'business_gstin', value: '22AAAAA0000A1Z5' }]) // settings
      .mockResolvedValueOnce([mockOrderItem])   // updated items

    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ value: 'JS' }], rowCount: 1 }),
      }
      return fn(mockClient as any)
    })

    mockGetFinancialYear.mockReturnValue('2024-25')
    mockGenerateInvoiceNumber.mockReturnValue('JS/2024-25/0002')
    mockIsInterState.mockReturnValue(false)
    mockCalculateGST.mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0, totalTax: 15.26 })
    mockGenerateInvoicePDF.mockResolvedValue(Buffer.from('pdf'))
    mockUploadInvoicePDF.mockResolvedValue('https://s3.example.com/inv.pdf')

    await generateOrderInvoice('order-1')

    const [, , , , billingAddress] = mockGenerateInvoicePDF.mock.calls[0]
    expect(billingAddress).toMatchObject({
      full_name: 'Jane Doe',
      city: 'Mumbai',
    })
  })

  it('passes undefined billingAddress when billing address row is not found', async () => {
    // billing_address_id differs from shipping_address_id but the row doesn't exist
    const orderWithBilling = {
      ...mockOrder,
      billing_address_id: 'addr-2',
      shipping_address_id: 'addr-1',
    }

    mockQueryOne
      .mockResolvedValueOnce(null)              // no finalized invoice
      .mockResolvedValueOnce(orderWithBilling)  // order
      .mockResolvedValueOnce(null)              // billing address row not found
      .mockResolvedValueOnce({ id: 'inv-up' })  // UPDATE pdf_url

    mockQueryMany
      .mockResolvedValueOnce([mockOrderItem])   // order items
      .mockResolvedValueOnce([{ key: 'business_gstin', value: '22AAAAA0000A1Z5' }]) // settings
      .mockResolvedValueOnce([mockOrderItem])   // updated items

    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ value: 'JS' }], rowCount: 1 }),
      }
      return fn(mockClient as any)
    })

    mockGetFinancialYear.mockReturnValue('2024-25')
    mockGenerateInvoiceNumber.mockReturnValue('JS/2024-25/0003')
    mockIsInterState.mockReturnValue(false)
    mockCalculateGST.mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0, totalTax: 15.26 })
    mockGenerateInvoicePDF.mockResolvedValue(Buffer.from('pdf'))
    mockUploadInvoicePDF.mockResolvedValue('https://s3.example.com/inv.pdf')

    const result = await generateOrderInvoice('order-1')

    // Should still succeed — billingAddress stays undefined when row missing
    expect(result).toBeInstanceOf(Buffer)
    const [, , , , billingAddress] = mockGenerateInvoicePDF.mock.calls[0]
    expect(billingAddress).toBeUndefined()
  })

  it('falls back to empty strings when billing address fields are null', async () => {
    // billing address row exists but all fields are null — exercises the || '' fallbacks
    // on lines 218-219 and 221-224 (right-hand sides of each || operator)
    const orderWithBilling = {
      ...mockOrder,
      billing_address_id: 'addr-2',
      shipping_address_id: 'addr-1',
    }

    mockQueryOne
      .mockResolvedValueOnce(null)              // no finalized invoice
      .mockResolvedValueOnce(orderWithBilling)  // order
      .mockResolvedValueOnce({                  // billing address with all-null fields
        full_name: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        phone: null,
      })
      .mockResolvedValueOnce({ id: 'inv-up' })  // UPDATE pdf_url

    mockQueryMany
      .mockResolvedValueOnce([mockOrderItem])   // order items
      .mockResolvedValueOnce([{ key: 'business_gstin', value: '22AAAAA0000A1Z5' }]) // settings
      .mockResolvedValueOnce([mockOrderItem])   // updated items

    mockWithTransaction.mockImplementation(async (fn) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ value: 'JS' }], rowCount: 1 }),
      }
      return fn(mockClient as any)
    })

    mockGetFinancialYear.mockReturnValue('2024-25')
    mockGenerateInvoiceNumber.mockReturnValue('JS/2024-25/0004')
    mockIsInterState.mockReturnValue(false)
    mockCalculateGST.mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0, totalTax: 15.26 })
    mockGenerateInvoicePDF.mockResolvedValue(Buffer.from('pdf'))
    mockUploadInvoicePDF.mockResolvedValue('https://s3.example.com/inv.pdf')

    await generateOrderInvoice('order-1')

    const [, , , , billingAddress] = mockGenerateInvoicePDF.mock.calls[0]
    expect(billingAddress).toMatchObject({
      full_name: '',
      address_line1: '',
      address_line2: null,
      city: '',
      state: '',
      postal_code: '',
      phone: '',
    })
  })
})
