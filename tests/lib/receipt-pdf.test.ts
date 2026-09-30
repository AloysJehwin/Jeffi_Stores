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
        dataCb?.(Buffer.from('mock-receipt-pdf'))
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
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      addPage: vi.fn().mockReturnThis(),
      switchToPage: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
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

import { generateReceiptPDF } from '@/lib/receipt-pdf'
import type { ReceiptBusinessSettings, ReceiptItem, ReceiptOrder } from '@/lib/receipt-pdf'

const mockBusiness: ReceiptBusinessSettings = {
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur, CG 492001',
  phone: '+91 96853 54099',
  gstin: '22AAAAA0000A1Z5',
}

const mockOrder: ReceiptOrder = {
  invoice_number: 'JS/2025-26/001',
  invoice_date: '2025-06-01T10:00:00.000Z',
  payment_mode: 'Cash',
  customer_name: 'Alice Kumar',
  notes: undefined,
  taxable_amount: 847.46,
  cgst_amount: 76.27,
  sgst_amount: 76.27,
  igst_amount: 0,
  is_igst: false,
  total_amount: 1000,
}

const mockItems: ReceiptItem[] = [
  {
    product_name: 'Widget A',
    quantity: 2,
    unit_price: 500,
    total_price: 1000,
    taxable_amount: 847.46,
    cgst_amount: 76.27,
    sgst_amount: 76.27,
    igst_amount: 0,
    gst_rate: 18,
  },
]

describe('receipt-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateReceiptPDF', () => {
    it('returns a Buffer', async () => {
      const result = await generateReceiptPDF(mockOrder, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('produces non-empty buffer', async () => {
      const result = await generateReceiptPDF(mockOrder, mockItems, mockBusiness)
      expect(result.length).toBeGreaterThan(0)
    })

    it('generates receipt with IGST layout', async () => {
      const igstOrder: ReceiptOrder = {
        ...mockOrder,
        is_igst: true,
        igst_amount: 152.54,
        cgst_amount: 0,
        sgst_amount: 0,
      }
      const result = await generateReceiptPDF(igstOrder, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order with notes', async () => {
      const orderWithNotes: ReceiptOrder = { ...mockOrder, notes: 'Thank you for your purchase!' }
      const result = await generateReceiptPDF(orderWithNotes, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles order without customer name', async () => {
      const orderNoName: ReceiptOrder = { ...mockOrder, customer_name: undefined }
      const result = await generateReceiptPDF(orderNoName, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles multiple items', async () => {
      const multiItems: ReceiptItem[] = [
        ...mockItems,
        {
          product_name: 'Gadget B',
          quantity: 1,
          unit_price: 250,
          total_price: 250,
          taxable_amount: 223.21,
          cgst_amount: 13.39,
          sgst_amount: 13.39,
          igst_amount: 0,
          gst_rate: 12,
        },
      ]
      const result = await generateReceiptPDF(mockOrder, multiItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles round-number amounts', async () => {
      const order: ReceiptOrder = {
        ...mockOrder,
        total_amount: 500,
        taxable_amount: 423.73,
        cgst_amount: 38.14,
        sgst_amount: 38.14,
      }
      const result = await generateReceiptPDF(order, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    // Covers toWords Lakh branch (lines 50): total_amount in range 100000–9999999
    it('handles total_amount in Lakh range for toWords coverage', async () => {
      const order: ReceiptOrder = {
        ...mockOrder,
        total_amount: 150000,
        taxable_amount: 127118.64,
        cgst_amount: 11440.68,
        sgst_amount: 11440.68,
      }
      const result = await generateReceiptPDF(order, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    // Covers toWords Crore branch (line 51): total_amount >= 10000000
    it('handles total_amount in Crore range for toWords coverage', async () => {
      const order: ReceiptOrder = {
        ...mockOrder,
        total_amount: 12500000,
        taxable_amount: 10593220.34,
        cgst_amount: 953389.83,
        sgst_amount: 953389.83,
      }
      const result = await generateReceiptPDF(order, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    // Covers hasDiscount branch (lines 212-214): item with discount_amount > 0
    it('renders discount line for items with a discount', async () => {
      const discountedItems: ReceiptItem[] = [
        {
          product_name: 'Discounted Widget',
          quantity: 2,
          unit_price: 600,
          discount_amount: 100,
          total_price: 1100,
          taxable_amount: 932.2,
          cgst_amount: 83.9,
          sgst_amount: 83.9,
          igst_amount: 0,
          gst_rate: 18,
        },
      ]
      const result = await generateReceiptPDF(mockOrder, discountedItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })
  })
})
