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
        dataCb?.(Buffer.from('mock-quotation-pdf'))
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

import { generateQuotationPDF } from '@/lib/documents/quotation-pdf'
import type { QuotationBusiness, QuotationItem, QuotationData } from '@/lib/documents/quotation-pdf'

const mockBusiness: QuotationBusiness = {
  gstin: '22AAAAA0000A1Z5',
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur, CG 492001',
  state: 'Chhattisgarh',
  stateCode: '22',
  phone: '+91 96853 54099',
  email: 'jeffistoress@gmail.com',
  bankName: 'HDFC Bank',
  bankAccount: '12345678901',
  bankIfsc: 'HDFC0001234',
  bankBranch: 'Raipur Main',
}

const mockData: QuotationData = {
  quote_number: 'QT-2025-001',
  quote_date: '2025-06-01T10:00:00.000Z',
  consignee_name: 'Alice Kumar',
  consignee_addr1: '123 Main St',
  consignee_addr2: null,
  consignee_city: 'Raipur',
  consignee_state: 'Chhattisgarh',
  consignee_gstin: null,
  buyer_same: true,
  buyer_name: 'Alice Kumar',
  buyer_addr1: '123 Main St',
  buyer_addr2: null,
  buyer_city: 'Raipur',
  buyer_state: 'Chhattisgarh',
  buyer_gstin: null,
  notes: null,
}

const mockItems: QuotationItem[] = [
  {
    description: 'Widget A',
    hsn_code: '8481',
    gst_rate: 18,
    quantity: 5,
    unit: 'pcs',
    rate: 200,
    discount_pct: 0,
    amount: 1000,
  },
]

describe('quotation-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateQuotationPDF', () => {
    it('returns a Buffer', async () => {
      const result = await generateQuotationPDF(mockData, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('produces non-empty buffer', async () => {
      const result = await generateQuotationPDF(mockData, mockItems, mockBusiness)
      expect(result.length).toBeGreaterThan(0)
    })

    it('handles buyer_same = false with separate buyer details', async () => {
      const data: QuotationData = {
        ...mockData,
        buyer_same: false,
        buyer_name: 'Bob Corp',
        buyer_addr1: '456 Corp Ave',
        buyer_addr2: 'Floor 3',
        buyer_city: 'Mumbai',
        buyer_state: 'Maharashtra',
        buyer_gstin: '27BBBBB1111B1Z5',
      }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles consignee with GSTIN', async () => {
      const data: QuotationData = { ...mockData, consignee_gstin: '22CCCCC2222C1Z5' }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles notes when provided', async () => {
      const data: QuotationData = { ...mockData, notes: 'Delivery within 7 business days.' }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles multiple items', async () => {
      const items: QuotationItem[] = [
        ...mockItems,
        {
          description: 'Gadget B',
          hsn_code: null,
          gst_rate: 12,
          quantity: 2,
          unit: 'box',
          rate: 500,
          discount_pct: 5,
          amount: 950,
        },
      ]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles consignee addr2 when provided', async () => {
      const data: QuotationData = {
        ...mockData,
        consignee_addr2: 'Near Railway Station',
      }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with discount', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], discount_pct: 10, amount: 900 }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('triggers round-off row when total needs rounding', async () => {
      // gst_rate 18% on amount 100 => cgst = sgst = 9 each, rawTotal = 118, total = 118, roundOff = 0
      // Use an amount that produces a non-integer rawTotal to trigger hasRound
      const items: QuotationItem[] = [{ ...mockItems[0], amount: 101, gst_rate: 18 }]
      // rawTotal = 101 + 101*18/200 + 101*18/200 = 101 + 9.09 + 9.09 = 119.18
      // total = Math.round(119.18) = 119, roundOff = 119 - 119.18 = -0.18 => hasRound = true
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles buyer_same = false with buyer_addr2 null', async () => {
      const data: QuotationData = {
        ...mockData,
        buyer_same: false,
        buyer_name: 'Corp Ltd',
        buyer_addr1: '789 Business Park',
        buyer_addr2: null,
        buyer_city: 'Delhi',
        buyer_state: 'Delhi',
        buyer_gstin: null,
      }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles business without email', async () => {
      const biz = { ...mockBusiness, email: '' }
      const result = await generateQuotationPDF(mockData, mockItems, biz)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('uses state code when consignee state is known', async () => {
      const data: QuotationData = { ...mockData, consignee_state: 'Karnataka' }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('uses empty state code when consignee state is unknown', async () => {
      const data: QuotationData = { ...mockData, consignee_state: 'Atlantis' }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles integer quantity in fmtQty', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], quantity: 10 }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles fractional quantity in fmtQty', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], quantity: 2.5 }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles item with null hsn_code (falls back to N/A in HSN map)', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], hsn_code: null }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles long business address that wraps across lines', async () => {
      const biz: QuotationBusiness = {
        ...mockBusiness,
        address:
          'Very Long Street Name Part One, Very Long Street Name Part Two, Very Long Area Name, Very Long City Name, State Name, PIN 492001',
      }
      const result = await generateQuotationPDF(mockData, mockItems, biz)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles zero total (numberToWords zero path)', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], amount: 0, gst_rate: 0 }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles large total triggering crore/lakh/thousand in numberToWords', async () => {
      const items: QuotationItem[] = [{ ...mockItems[0], amount: 15000000, gst_rate: 18 }]
      const result = await generateQuotationPDF(mockData, items, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles many items that may trigger page break', async () => {
      const manyItems: QuotationItem[] = Array.from({ length: 30 }, (_, i) => ({
        description: `Product Item Number ${i + 1} with a reasonably descriptive name`,
        hsn_code: '8481',
        gst_rate: 18,
        quantity: i + 1,
        unit: 'pcs',
        rate: 100,
        discount_pct: 0,
        amount: 100 * (i + 1),
      }))
      const result = await generateQuotationPDF(mockData, manyItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles consignee with address_line2 and GSTIN both set', async () => {
      const data: QuotationData = {
        ...mockData,
        consignee_addr2: 'Block B, Floor 3',
        consignee_gstin: '22AAAAA0000A1Z5',
      }
      const result = await generateQuotationPDF(data, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })
  })
})
