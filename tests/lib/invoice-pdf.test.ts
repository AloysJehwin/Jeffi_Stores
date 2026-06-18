import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('pdfkit', () => {
  function makeMockDoc() {
    let dataCb: ((c: Buffer) => void) | null = null
    let endCb: (() => void) | null = null
    const doc: Record<string, any> = {
      on: vi.fn().mockImplementation(function (event: string, cb: any) {
        if (event === 'data') dataCb = cb
        if (event === 'end') endCb = cb
        return doc
      }),
      end: vi.fn().mockImplementation(function () {
        dataCb?.(Buffer.from('mock-invoice-pdf'))
        endCb?.()
      }),
      font: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(),
      strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      addPage: vi.fn().mockReturnThis(),
      switchToPage: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
      translate: vi.fn().mockReturnThis(),
      rotate: vi.fn().mockReturnThis(),
      scale: vi.fn().mockReturnThis(),
      polygon: vi.fn().mockReturnThis(),
      path: vi.fn().mockReturnThis(),
      bufferedPageRange: vi.fn().mockReturnValue({ start: 0, count: 1 }),
      heightOfString: vi.fn().mockReturnValue(20),
      widthOfString: vi.fn().mockReturnValue(100),
      x: 50,
      y: 100,
      page: { width: 595.28, height: 841.89, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
    return doc
  }
  return { default: vi.fn().mockImplementation(() => makeMockDoc()) }
})

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr') },
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

import { generateInvoicePDF } from '@/lib/invoice-pdf'
import type {
  InvoiceOrder,
  InvoiceOrderItem,
  InvoiceBusinessSettings,
  InvoiceBuyerAddress,
} from '@/lib/invoice-pdf'

const mockBusiness: InvoiceBusinessSettings = {
  gstin: '22AAAAA0000A1Z5',
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur',
  state: 'Chhattisgarh',
  stateCode: '22',
  phone: '+91 96853 54099',
  email: 'jeffistoress@gmail.com',
  bankName: 'HDFC Bank',
  bankAccount: '12345678901',
  bankIfsc: 'HDFC0001234',
  bankBranch: 'Raipur Main',
}

const mockOrder: InvoiceOrder = {
  order_number: 'ORD-001',
  invoice_number: 'JS/2025-26/001',
  invoice_date: '2025-06-01T10:00:00.000Z',
  customer_name: 'Alice Kumar',
  subtotal: 1000,
  tax_amount: 180,
  total_amount: 1180,
  discount_amount: 0,
  shipping_amount: 0,
  taxable_amount: 847.46,
  cgst_amount: 76.27,
  sgst_amount: 76.27,
  igst_amount: 0,
  is_igst: false,
  buyer_gstin: null,
  order_date: '2025-06-01T09:00:00.000Z',
  payment_mode: 'Online Payment',
  tracking_number: '',
  shipped_at: '',
  shipping_method: '',
  destination: 'Raipur, Chhattisgarh',
  irn: null,
  irn_ack_no: null,
  irn_ack_dt: null,
  signed_qr_code: null,
  payment_link_url: null,
  eway_bill_no: null,
}

const mockItems: InvoiceOrderItem[] = [
  {
    product_name: 'Widget A',
    hsn_code: '8481',
    gst_rate: 18,
    quantity: 2,
    unit_price: 500,
    total_price: 1000,
    taxable_amount: 847.46,
    cgst_amount: 76.27,
    sgst_amount: 76.27,
    igst_amount: 0,
    buy_mode: 'unit',
    buy_unit: null,
  },
]

const mockBuyer: InvoiceBuyerAddress = {
  full_name: 'Alice Kumar',
  address_line1: '123 Main St',
  address_line2: null,
  city: 'Raipur',
  state: 'Chhattisgarh',
  postal_code: '492001',
  phone: '9876543210',
}

describe('invoice-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateInvoicePDF', () => {
    it('returns a Buffer', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('produces non-empty buffer', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer)
      expect(result.length).toBeGreaterThan(0)
    })

    it('generates PDF with IGST when is_igst is true', async () => {
      const igstOrder = { ...mockOrder, is_igst: true, igst_amount: 152.54, cgst_amount: 0, sgst_amount: 0 }
      const result = await generateInvoicePDF(igstOrder, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('includes billing address when different from shipping', async () => {
      const billingAddress: InvoiceBuyerAddress = {
        full_name: 'Alice Kumar',
        address_line1: '456 Business Rd',
        address_line2: 'Floor 2',
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400001',
        phone: '9999999999',
      }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer, billingAddress)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('generates cancelled/voided invoice', async () => {
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, mockBuyer, undefined, true, 'CANCELLED')
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with signed QR code', async () => {
      const orderWithQr = { ...mockOrder, signed_qr_code: 'base64-qr-data' }
      const result = await generateInvoicePDF(orderWithQr, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with IRN details', async () => {
      const orderWithIrn = {
        ...mockOrder,
        irn: 'abc123irn',
        irn_ack_no: 'ACK001',
        irn_ack_dt: '2025-06-01',
      }
      const result = await generateInvoicePDF(orderWithIrn, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles multiple items', async () => {
      const multiItems: InvoiceOrderItem[] = [
        ...mockItems,
        {
          product_name: 'Gadget B',
          hsn_code: '8542',
          gst_rate: 12,
          quantity: 1,
          unit_price: 250,
          total_price: 250,
          taxable_amount: 223.21,
          cgst_amount: 13.39,
          sgst_amount: 13.39,
          igst_amount: 0,
          buy_mode: 'unit',
          buy_unit: null,
        },
      ]
      const result = await generateInvoicePDF(mockOrder, multiItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles discount and shipping amounts', async () => {
      const orderWithDiscount = {
        ...mockOrder,
        discount_amount: 100,
        shipping_amount: 50,
      }
      const result = await generateInvoicePDF(orderWithDiscount, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with buy_unit set', async () => {
      const itemsWithUnit: InvoiceOrderItem[] = [
        { ...mockItems[0], buy_mode: 'box', buy_unit: 'Box of 12' },
      ]
      const result = await generateInvoicePDF(mockOrder, itemsWithUnit, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer with address_line2', async () => {
      const buyer2 = { ...mockBuyer, address_line2: 'Near Bus Stand' }
      const result = await generateInvoicePDF(mockOrder, mockItems, mockBusiness, buyer2)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer_gstin when provided', async () => {
      const orderWithGstin = { ...mockOrder, buyer_gstin: '27BBBBB1111B1Z5' }
      const result = await generateInvoicePDF(orderWithGstin, mockItems, mockBusiness, mockBuyer)
      expect(result).toBeInstanceOf(Buffer)
    })
  })
})
