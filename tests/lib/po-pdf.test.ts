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
        dataCb?.(Buffer.from('mock-po-pdf'))
        endCb?.()
      }),
      font: vi.fn().mockReturnThis(), fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(), strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(), text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(), moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(), stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(), rect: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(), opacity: vi.fn().mockReturnThis(),
      addPage: vi.fn().mockReturnThis(), switchToPage: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(), restore: vi.fn().mockReturnThis(),
      bufferedPageRange: vi.fn().mockReturnValue({ start: 0, count: 1 }),
      heightOfString: vi.fn().mockReturnValue(20),
      widthOfString: vi.fn().mockReturnValue(100),
      x: 50, y: 100,
      page: { width: 595.28, height: 841.89, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
    return doc
  }
  return { default: vi.fn().mockImplementation(() => makeMockDoc()) }
})

import { generatePurchaseOrderPDF } from '@/lib/po-pdf'
import type { POItem, POBusinessSettings } from '@/lib/po-pdf'

const mockBusiness: POBusinessSettings = {
  legalName: 'Jeffi Stores Pvt Ltd',
  tradeName: 'Jeffi Stores',
  address: 'Station Road, Raipur, CG 492001',
  phone: '+91 96853 54099',
  email: 'jeffistoress@gmail.com',
  gstin: '22AAAAA0000A1Z5',
}

const mockPO = {
  po_number: 'PO-2025-001',
  order_date: '2025-06-01T10:00:00.000Z',
  expected_date: '2025-06-15T10:00:00.000Z',
  notes: null,
  total_amount: 5000,
  supplier_name: 'Acme Supplies',
  contact_name: 'Bob Supplier',
  supplier_address: '789 Industrial Road, Mumbai',
  supplier_gstin: '27AAAAA0000A1Z5',
  supplier_email: 'bob@acme.com',
}

const mockItems: POItem[] = [
  { product_name: 'Bolt Set', variant_name: '10mm', quantity: 100, unit_cost: 25 },
  { product_name: 'Nut Set', variant_name: null, quantity: 100, unit_cost: 25 },
]

describe('po-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generatePurchaseOrderPDF', () => {
    it('returns a Buffer', async () => {
      const result = await generatePurchaseOrderPDF(mockPO, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('produces non-empty buffer', async () => {
      const result = await generatePurchaseOrderPDF(mockPO, mockItems, mockBusiness)
      expect(result.length).toBeGreaterThan(0)
    })

    it('handles PO without optional fields', async () => {
      const minimalPO = {
        po_number: 'PO-2025-002',
        order_date: '2025-06-01T00:00:00.000Z',
        expected_date: null,
        notes: null,
        total_amount: '1000',
        supplier_name: 'Simple Supplier',
        contact_name: null,
        supplier_address: null,
        supplier_gstin: null,
        supplier_email: null,
      }
      const result = await generatePurchaseOrderPDF(minimalPO, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles PO with notes', async () => {
      const poWithNotes = { ...mockPO, notes: 'Please deliver by end of month.' }
      const result = await generatePurchaseOrderPDF(poWithNotes, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles total_amount as string', async () => {
      const poStrAmount = { ...mockPO, total_amount: '7500.50' }
      const result = await generatePurchaseOrderPDF(poStrAmount, mockItems, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('handles single item without variant', async () => {
      const singleItem: POItem[] = [
        { product_name: 'Widget', variant_name: null, quantity: 10, unit_cost: 100 },
      ]
      const result = await generatePurchaseOrderPDF(mockPO, singleItem, mockBusiness)
      expect(result).toBeInstanceOf(Buffer)
    })

    it('uses tradeName when legalName differs', async () => {
      const business = { ...mockBusiness, tradeName: 'Jeffi Trade Name' }
      const result = await generatePurchaseOrderPDF(mockPO, mockItems, business)
      expect(result).toBeInstanceOf(Buffer)
    })
  })
})
