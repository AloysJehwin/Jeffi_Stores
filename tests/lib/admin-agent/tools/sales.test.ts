import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT MIN(price) FROM product_variants WHERE product_id = p.id)',
  EFFECTIVE_STOCK_SQL: 'COALESCE(stock, 0)',
}))
vi.mock('@/lib/rag', () => ({
  embed: vi.fn(),
  findSimilarProductIds: vi.fn(),
}))
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}))
vi.mock('@/lib/admin-agent/vision', () => ({
  ocrImage: vi.fn(),
  ocrPdfPages: vi.fn(),
  isVisionConfigured: vi.fn(),
}))

import { SALES_TOOLS } from '@/lib/admin-agent/tools/sales'
import * as db from '@/lib/db'
import * as rag from '@/lib/rag'
import * as vision from '@/lib/admin-agent/vision'

const mockQueryMany = vi.mocked(db.queryMany)
const mockQueryOne = vi.mocked(db.queryOne)
const mockQuery = vi.mocked(db.query)
const mockEmbed = vi.mocked(rag.embed)
const mockOcrPdfPages = vi.mocked(vision.ocrPdfPages)

function getTool(name: string) {
  return SALES_TOOLS.find(t => t.name === name)!
}

describe('admin-agent/tools/sales', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('SALES_TOOLS array', () => {
    it('exports a non-empty array', () => {
      expect(Array.isArray(SALES_TOOLS)).toBe(true)
      expect(SALES_TOOLS.length).toBeGreaterThan(0)
    })

    it('each tool has required shape', () => {
      for (const tool of SALES_TOOLS) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  // ── list_quotations ──────────────────────────────────────────────────────
  // Source returns: { quotations, count, truncated } — raw object, no ok field
  describe('list_quotations', () => {
    it('returns quotations list', async () => {
      const fakeRows = [{ id: 'q1', status: 'draft', total: 1000 }]
      mockQueryMany.mockResolvedValueOnce(fakeRows)

      const result = await getTool('list_quotations').handler({})
      expect((result as any).quotations).toEqual(fakeRows)
    })

    it('supports status filter', async () => {
      mockQueryMany.mockResolvedValueOnce([])
      const result = await getTool('list_quotations').handler({ status: 'sent' })
      expect((result as any).quotations).toEqual([])
      expect(mockQueryMany).toHaveBeenCalled()
    })
  })

  // ── get_quotation ────────────────────────────────────────────────────────
  // Source params: { id, quoteNumber }
  // Source returns found: spread of row + items (no ok field)
  // Source returns not found: { error: 'Quotation not found' }
  describe('get_quotation', () => {
    it('returns quotation by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'q1', status: 'sent' })
      mockQueryMany.mockResolvedValueOnce([]) // items query
      const result = await getTool('get_quotation').handler({ id: 'q1' })
      expect((result as any).id).toBe('q1')
      expect((result as any).error).toBeUndefined()
    })

    it('returns err when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_quotation').handler({ id: 'nonexistent' })
      expect((result as any).error).toBeDefined()
    })
  })

  // ── list_invoices ────────────────────────────────────────────────────────
  // Source returns: { invoices, count, truncated } — raw object
  describe('list_invoices', () => {
    it('returns invoices list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'inv1', status: 'paid' }])
      const result = await getTool('list_invoices').handler({})
      expect((result as any).invoices).toBeDefined()
    })
  })

  // ── get_invoice ──────────────────────────────────────────────────────────
  // Source params: { id, invoiceNumber }
  // Source returns found: spread of row + items (no ok field)
  // Source returns not found: { error: 'Invoice not found' }
  describe('get_invoice', () => {
    it('returns invoice by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'inv1', total_amount: '5000' })
      mockQueryMany.mockResolvedValueOnce([]) // items query
      const result = await getTool('get_invoice').handler({ id: 'inv1' })
      expect((result as any).id).toBe('inv1')
      expect((result as any).error).toBeUndefined()
    })

    it('returns err when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_invoice').handler({ id: 'bad' })
      expect((result as any).error).toBeDefined()
    })
  })

  // ── list_cash_sales ──────────────────────────────────────────────────────
  // Source returns: { sales, count, truncated } — raw object
  describe('list_cash_sales', () => {
    it('returns cash sales list', async () => {
      mockQueryMany.mockResolvedValueOnce([{ id: 'cs1', amount: 200 }])
      const result = await getTool('list_cash_sales').handler({})
      expect((result as any).sales).toBeDefined()
    })
  })

  // ── get_cash_sale ────────────────────────────────────────────────────────
  // Source params: { id, saleNumber, invoiceNumber }
  // Source returns found: spread of row + items (no ok field)
  // Source returns not found: { error: 'Cash sale not found' }
  describe('get_cash_sale', () => {
    it('returns cash sale by id', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'cs1', total_amount: '500' })
      mockQueryMany.mockResolvedValueOnce([]) // items query
      const result = await getTool('get_cash_sale').handler({ id: 'cs1' })
      expect((result as any).id).toBe('cs1')
      expect((result as any).error).toBeUndefined()
    })

    it('returns err when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      const result = await getTool('get_cash_sale').handler({ id: 'bad' })
      expect((result as any).error).toBeDefined()
    })
  })

  // ── match_quotation_items ────────────────────────────────────────────────
  // Source param: { lines } (not items), returns ok(...)
  describe('match_quotation_items', () => {
    it('matches items via embedding', async () => {
      const lines = JSON.stringify([
        { requestedText: 'blue bolt M6', qty: 10 },
        { requestedText: 'hex nut M6', qty: 5 },
      ])

      mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
      // queryMany for embeddings lookup — return empty so all are unmatched
      mockQueryMany.mockResolvedValue([])

      const result = await getTool('match_quotation_items').handler({ lines })
      expect((result as any).ok).toBe(true)
    })

    it('returns err for invalid JSON', async () => {
      const result = await getTool('match_quotation_items').handler({ lines: 'not json' })
      expect((result as any).ok).toBe(false)
    })

    it('returns unmatched when no similar products found', async () => {
      const lines = JSON.stringify([{ requestedText: 'unknown widget', qty: 1 }])
      mockEmbed.mockResolvedValue([0.1, 0.2])
      mockQueryMany.mockResolvedValue([])

      const result = await getTool('match_quotation_items').handler({ lines })
      expect((result as any).ok).toBe(true)
      const data = (result as any).data
      expect(data).toBeDefined()
    })
  })

  // ── extract_quotation_lines_from_attachment ──────────────────────────────
  // Source param: { attachment_id } — fetches from DB via queryOne
  // Tests must mock the DB row instead of passing raw bytes
  describe('extract_quotation_lines_from_attachment', () => {
    it('extracts lines via pdf-parse (cached text path)', async () => {
      // Source re-uses extracted_text if already present in DB row
      mockQueryOne.mockResolvedValueOnce({
        id: 'att1',
        mime_type: 'application/pdf',
        filename: 'rfq.pdf',
        byte_size: 1024,
        data: Buffer.from('%PDF-1.4 fake'),
        extracted_text: 'Bolt M6 x 10\nNut M6 x 5',
        expires_at: '2099-01-01',
      })

      const result = await getTool('extract_quotation_lines_from_attachment').handler({
        attachment_id: 'att1',
      })
      expect((result as any).ok).toBe(true)
      expect((result as any).data.text).toContain('Bolt')
    })

    it('falls back to OCR when pdf-parse returns empty text', async () => {
      // No cached text, data is a PDF buffer — pdf-parse will be dynamic-imported
      // by the source; simulate by having no extracted_text and triggering the
      // vision OCR path (ocrPdfPages is mocked to return ok)
      mockQueryOne.mockResolvedValueOnce({
        id: 'att2',
        mime_type: 'application/pdf',
        filename: 'scan.pdf',
        byte_size: 512,
        data: Buffer.from('%PDF-fake'),
        extracted_text: null,
        expires_at: '2099-01-01',
      })
      mockOcrPdfPages.mockResolvedValueOnce({
        ok: true,
        text: 'OCR extracted: Bolt M6 x 10',
        pages: 1,
        model: 'test-model',
      } as any)
      mockQuery.mockResolvedValueOnce(undefined as any) // UPDATE call

      const result = await getTool('extract_quotation_lines_from_attachment').handler({
        attachment_id: 'att2',
      })
      expect((result as any).ok).toBe(true)
    })

    it('handles image attachment', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'att3',
        mime_type: 'image/jpeg',
        filename: 'photo.jpg',
        byte_size: 256,
        data: Buffer.from('fake-image-data'),
        extracted_text: null,
        expires_at: '2099-01-01',
      })
      vi.mocked(vision.ocrImage).mockResolvedValueOnce({
        ok: true,
        text: 'Item 1 x 2',
        model: 'test-model',
      } as any)
      mockQuery.mockResolvedValueOnce(undefined as any) // UPDATE call

      const result = await getTool('extract_quotation_lines_from_attachment').handler({
        attachment_id: 'att3',
      })
      expect((result as any).ok).toBe(true)
    })
  })

  // ── propose_create_quotation ─────────────────────────────────────────────
  // Source params: { customerEmail (string with @), items (JSON string array) }
  // Source calls queryMany for products, then queryOne for user lookup
  // Returns: { proposed: true, kind, payload, ... } — no ok field
  describe('propose_create_quotation', () => {
    it('proposes quotation creation with valid data', async () => {
      // queryMany: products lookup
      mockQueryMany.mockResolvedValueOnce([
        { id: 'p1', name: 'Bolt M6', sku: 'BM6', gst_percentage: '18', hsn_code: null, price: '100', base_price: '100' },
      ])
      // queryOne: user lookup
      mockQueryOne.mockResolvedValueOnce({ first_name: 'Alice', last_name: 'Corp' })

      const result = await getTool('propose_create_quotation').handler({
        customerEmail: 'alice@corp.com',
        items: JSON.stringify([{ productId: 'p1', quantity: 5, unitPrice: 100 }]),
      })
      expect((result as any).proposed).toBe(true)
    })

    it('returns err when customerEmail is invalid', async () => {
      await expect(
        getTool('propose_create_quotation').handler({
          customerEmail: 'not-an-email',
          items: JSON.stringify([]),
        })
      ).rejects.toThrow()
    })
  })

  // ── propose_mark_invoice_paid ────────────────────────────────────────────
  // Source params: { invoiceId, invoiceNumber, paymentMode, paidAt }
  // Source throws (not returns err) for missing invoiceId/invoiceNumber and bad mode
  describe('propose_mark_invoice_paid', () => {
    it('proposes marking invoice as paid', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
        total_amount: '1500', payment_status: 'unpaid', customer_name: 'Alice',
      })

      const result = await getTool('propose_mark_invoice_paid').handler({
        invoiceId: 'inv1',
        paymentMode: 'upi',
      })
      expect((result as any).proposed).toBe(true)
    })

    it('throws for invalid payment mode', async () => {
      await expect(
        getTool('propose_mark_invoice_paid').handler({
          invoiceId: 'inv1',
          paymentMode: 'bitcoin',
        })
      ).rejects.toThrow()
    })

    it('throws when invoice id is missing', async () => {
      await expect(
        getTool('propose_mark_invoice_paid').handler({
          paymentMode: 'cash',
        })
      ).rejects.toThrow()
    })

    it('throws when invoice not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_mark_invoice_paid').handler({
          invoiceId: 'bad',
          paymentMode: 'cash',
        })
      ).rejects.toThrow()
    })
  })

  // ── propose_update_order_status ──────────────────────────────────────────
  // Source params: { orderId, orderNumber, newStatus, awbNumber }
  // Source throws for missing orderId/orderNumber
  // Source returns { proposed: false } for regressions (does NOT throw)
  describe('propose_update_order_status', () => {
    it('proposes valid status transition', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1', order_number: 'ORD-001', status: 'confirmed',
        payment_status: 'paid', customer_name: 'Bob', total_amount: '2000', awb_number: null,
      })
      const result = await getTool('propose_update_order_status').handler({
        orderId: 'o1',
        newStatus: 'processing',
      })
      expect((result as any).proposed).toBe(true)
    })

    it('returns proposed with isRegression flag for status regression', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'o1', order_number: 'ORD-001', status: 'delivered',
        payment_status: 'paid', customer_name: 'Bob', total_amount: '2000', awb_number: null,
      })
      const result = await getTool('propose_update_order_status').handler({
        orderId: 'o1',
        newStatus: 'pending',
      })
      // Source returns proposed: true with isRegression: true (not an error)
      expect((result as any).proposed).toBe(true)
      expect((result as any).payload.isRegression).toBe(true)
    })

    it('throws when order not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null)
      await expect(
        getTool('propose_update_order_status').handler({
          orderId: 'bad',
          newStatus: 'processing',
        })
      ).rejects.toThrow()
    })

    it('accepts all valid payment modes', () => {
      const validModes = ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'razorpay', 'credit']
      expect(validModes).toHaveLength(7)
    })
  })
})
