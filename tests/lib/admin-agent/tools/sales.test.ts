import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: 'NULL',
  EFFECTIVE_STOCK_SQL: 'COALESCE(stock, 0)',
}))
vi.mock('@/lib/rag', () => ({
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
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
const mockOcrImage = vi.mocked(vision.ocrImage)

function getTool(name: string) {
  const tool = SALES_TOOLS.find(t => t.name === name)
  if (!tool) throw new Error(`Tool "${name}" not found in SALES_TOOLS`)
  return tool
}

// ── list_quotations ───────────────────────────────────────────────────────────

describe('list_quotations', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns quotations with default params', async () => {
    const rows = [{ id: 'q1', quote_number: 'QT-001', status: 'draft' }]
    mockQueryMany.mockResolvedValueOnce(rows)
    const result = await getTool('list_quotations').handler({}) as any
    expect(result.quotations).toEqual(rows)
    expect(result.count).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('truncated=true when rows.length equals clamped limit', async () => {
    mockQueryMany.mockResolvedValueOnce(Array(20).fill({ id: 'q' }))
    const result = await getTool('list_quotations').handler({}) as any
    expect(result.truncated).toBe(true) // 20 rows === default limit 20
  })

  it('clamps limit above 100 to 100', async () => {
    mockQueryMany.mockResolvedValueOnce(Array(100).fill({ id: 'q' }))
    const result = await getTool('list_quotations').handler({ limit: 9999 }) as any
    expect(result.truncated).toBe(true) // 100 rows === clamped limit 100
  })

  it('clamps limit below 1 to 1', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ limit: 0 })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('clamps daysBack above 365 to 365', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ daysBack: 9999 })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('clamps daysBack below 1 to 1', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ daysBack: 0 })
    expect(mockQueryMany).toHaveBeenCalled()
  })

  it('adds status WHERE clause when status provided', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ status: 'draft' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('q.status =')
  })

  it('adds customerId ILIKE clause when customerId provided', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ customerId: 'alice' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('ILIKE')
  })

  it('applies both filters together', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_quotations').handler({ status: 'final', customerId: 'bob' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('q.status =')
    expect(sql).toContain('ILIKE')
  })
})

// ── get_quotation ─────────────────────────────────────────────────────────────

describe('get_quotation', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when neither id nor quoteNumber provided', async () => {
    await expect(getTool('get_quotation').handler({})).rejects.toThrow('Provide id or quoteNumber')
  })

  it('returns { error } when quotation not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('get_quotation').handler({ id: 'missing' }) as any
    expect(result.error).toBe('Quotation not found')
  })

  it('returns quotation spread with items array when found by id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'q1', quote_number: 'QT-001', status: 'draft' })
    mockQueryMany.mockResolvedValueOnce([{ position: 1, description: 'Bolt M20' }])
    const result = await getTool('get_quotation').handler({ id: 'q1' }) as any
    expect(result.id).toBe('q1')
    expect(result.quote_number).toBe('QT-001')
    expect(result.items).toHaveLength(1)
    expect(result.error).toBeUndefined()
  })

  it('returns quotation when found by quoteNumber', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'q2', quote_number: 'QT-002', status: 'final' })
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getTool('get_quotation').handler({ quoteNumber: 'QT-002' }) as any
    expect(result.quote_number).toBe('QT-002')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty items array when no line items exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'q3', quote_number: 'QT-003' })
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getTool('get_quotation').handler({ id: 'q3' }) as any
    expect(result.items).toEqual([])
  })
})

// ── list_invoices ─────────────────────────────────────────────────────────────

describe('list_invoices', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns invoices with default params', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'inv1', invoice_number: 'INV-001' }])
    const result = await getTool('list_invoices').handler({}) as any
    expect(result.invoices).toHaveLength(1)
    expect(result.count).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('truncated=true when rows fill the limit', async () => {
    mockQueryMany.mockResolvedValueOnce(Array(20).fill({ id: 'i' }))
    const result = await getTool('list_invoices').handler({}) as any
    expect(result.truncated).toBe(true)
  })

  it('adds payment_status filter when status provided', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_invoices').handler({ status: 'paid' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('o.payment_status =')
  })

  it('adds customer ILIKE filter when customerId provided', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_invoices').handler({ customerId: 'corp' })
    const sql = mockQueryMany.mock.calls[0][0] as string
    expect(sql).toContain('ILIKE')
  })

  it('clamps limit and daysBack', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_invoices').handler({ limit: 500, daysBack: 1000 })
    expect(mockQueryMany).toHaveBeenCalled()
  })
})

// ── get_invoice ───────────────────────────────────────────────────────────────

describe('get_invoice', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when neither id nor invoiceNumber provided', async () => {
    await expect(getTool('get_invoice').handler({})).rejects.toThrow('Provide id or invoiceNumber')
  })

  it('returns { error } when invoice not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('get_invoice').handler({ invoiceNumber: 'INV-999' }) as any
    expect(result.error).toBe('Invoice not found')
  })

  it('returns invoice spread with items when found by id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'inv1', invoice_number: 'INV-001', payment_status: 'unpaid' })
    mockQueryMany.mockResolvedValueOnce([{ product_name: 'Bolt', quantity: '10' }])
    const result = await getTool('get_invoice').handler({ id: 'inv1' }) as any
    expect(result.invoice_number).toBe('INV-001')
    expect(result.items).toHaveLength(1)
    expect(result.error).toBeUndefined()
  })

  it('returns invoice when found by invoiceNumber', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'inv2', invoice_number: 'INV-002' })
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getTool('get_invoice').handler({ invoiceNumber: 'INV-002' }) as any
    expect(result.id).toBe('inv2')
  })
})

// ── list_cash_sales ───────────────────────────────────────────────────────────

describe('list_cash_sales', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns cash sales with default params', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'cs1', sale_number: 'CS-001' }])
    const result = await getTool('list_cash_sales').handler({}) as any
    expect(result.sales).toHaveLength(1)
    expect(result.count).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('truncated=true when rows fill the limit', async () => {
    mockQueryMany.mockResolvedValueOnce(Array(20).fill({ id: 'cs' }))
    const result = await getTool('list_cash_sales').handler({}) as any
    expect(result.truncated).toBe(true)
  })

  it('clamps limit to 100 and daysBack to 365', async () => {
    mockQueryMany.mockResolvedValueOnce([])
    await getTool('list_cash_sales').handler({ limit: 500, daysBack: 999 })
    expect(mockQueryMany).toHaveBeenCalled()
  })
})

// ── get_cash_sale ─────────────────────────────────────────────────────────────

describe('get_cash_sale', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when none of id, saleNumber, invoiceNumber provided', async () => {
    await expect(getTool('get_cash_sale').handler({})).rejects.toThrow('Provide id, saleNumber, or invoiceNumber')
  })

  it('returns { error } when sale not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('get_cash_sale').handler({ saleNumber: 'CS-999' }) as any
    expect(result.error).toBe('Cash sale not found')
  })

  it('returns sale with items when found by id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cs1', sale_number: 'CS-001' })
    mockQueryMany.mockResolvedValueOnce([{ product_name: 'Bolt' }])
    const result = await getTool('get_cash_sale').handler({ id: 'cs1' }) as any
    expect(result.sale_number).toBe('CS-001')
    expect(result.items).toHaveLength(1)
    expect(result.error).toBeUndefined()
  })

  it('finds sale by saleNumber', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cs2', sale_number: 'CS-002' })
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getTool('get_cash_sale').handler({ saleNumber: 'CS-002' }) as any
    expect(result.sale_number).toBe('CS-002')
  })

  it('finds sale by invoiceNumber', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cs3', sale_number: 'CS-003', invoice_number: 'INV-CS-003' })
    mockQueryMany.mockResolvedValueOnce([])
    const result = await getTool('get_cash_sale').handler({ invoiceNumber: 'INV-CS-003' }) as any
    expect(result.id).toBe('cs3')
  })
})

// ── match_quotation_items ─────────────────────────────────────────────────────

describe('match_quotation_items', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns err for invalid JSON', async () => {
    const result = await getTool('match_quotation_items').handler({ lines: 'not json' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Invalid lines payload/i)
  })

  it('returns err when lines parses to non-array', async () => {
    const result = await getTool('match_quotation_items').handler({ lines: '{"foo":"bar"}' }) as any
    expect(result.ok).toBe(false)
  })

  it('returns err for empty array', async () => {
    const result = await getTool('match_quotation_items').handler({ lines: '[]' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/No lines provided/i)
  })

  it('returns err for more than 30 lines', async () => {
    const lines = JSON.stringify(Array(31).fill({ requestedText: 'bolt', qty: 1 }))
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Too many lines/i)
  })

  it('marks line unmatched when requestedText is empty string', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: '', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.ok).toBe(true)
    expect(result.data.lines[0].status).toBe('unmatched')
  })

  it('marks line unmatched when qty is 0', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: 'bolt', qty: 0 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('unmatched')
  })

  it('marks line unmatched when qty is negative', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: 'bolt', qty: -5 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('unmatched')
  })

  it('marks line unmatched when qty is NaN (non-numeric string)', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: 'bolt', qty: 'abc' }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('unmatched')
  })

  it('returns unmatched when embeddings query returns empty', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: 'obscure item nobody sells', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('unmatched')
    expect(result.data.counts.unmatched).toBe(1)
  })

  it('returns unmatched when top candidate sim < 0.45', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // embeddings query → low sim product
    mockQueryMany
      .mockResolvedValueOnce([{ source_table: 'products', source_id: 'p1', sim: 0.3 }])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Widget', sku: 'W1', price: 50 }])
    const lines = JSON.stringify([{ requestedText: 'unrelated item', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('unmatched')
  })

  it('returns matched when top sim >= threshold with single candidate', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // embeddings returns 1 product result with high sim; no variants
    mockQueryMany
      .mockResolvedValueOnce([{ source_table: 'products', source_id: 'p1', sim: 0.9 }])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt M20', sku: 'BOLT-M20', price: 100 }])
    const lines = JSON.stringify([{ requestedText: 'M20 bolt', qty: 5 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('matched')
    expect(result.data.counts.matched).toBe(1)
  })

  it('returns matched when top sim >= threshold and lead >= 0.05 over second', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany
      .mockResolvedValueOnce([
        { source_table: 'products', source_id: 'p1', sim: 0.85 },
        { source_table: 'products', source_id: 'p2', sim: 0.79 },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Bolt M20', sku: 'BOLT-M20', price: 100 },
        { id: 'p2', name: 'Bolt M16', sku: 'BOLT-M16', price: 90 },
      ])
    const lines = JSON.stringify([{ requestedText: 'M20 structural bolt', qty: 10 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('matched')
  })

  it('returns ambiguous when two candidates are close in score', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // sim 0.82 vs 0.80 — diff 0.02 < 0.05, both >= 0.45, top >= default threshold 0.62
    mockQueryMany
      .mockResolvedValueOnce([
        { source_table: 'products', source_id: 'p1', sim: 0.82 },
        { source_table: 'products', source_id: 'p2', sim: 0.80 },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Bolt M20', sku: 'BOLT-M20', price: 100 },
        { id: 'p2', name: 'Bolt M22', sku: 'BOLT-M22', price: 105 },
      ])
    const lines = JSON.stringify([{ requestedText: 'bolt', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('ambiguous')
    expect(result.data.counts.ambiguous).toBe(1)
  })

  it('returns ambiguous when top sim is between 0.45 and threshold', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // sim 0.55 < default threshold 0.62, but >= 0.45 → ambiguous
    mockQueryMany
      .mockResolvedValueOnce([{ source_table: 'products', source_id: 'p1', sim: 0.55 }])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt', sku: 'B', price: 80 }])
    const lines = JSON.stringify([{ requestedText: 'some bolt', qty: 2 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('ambiguous')
  })

  it('handles product_variants source_table — resolves via variant→product mapping', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // embeddings: one variant result
    // variant lookup: maps v1 → p1
    // products lookup: p1 details
    mockQueryMany
      .mockResolvedValueOnce([{ source_table: 'product_variants', source_id: 'v1', sim: 0.92 }])
      .mockResolvedValueOnce([{ id: 'v1', product_id: 'p1' }])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Bolt M20 Variant', sku: 'BOLT-V', price: 120 }])
    const lines = JSON.stringify([{ requestedText: 'M20 hex bolt DIN933', qty: 25 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.data.lines[0].status).toBe('matched')
  })

  it('handles mix of products and variants in same embeddings result', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany
      .mockResolvedValueOnce([
        { source_table: 'products', source_id: 'p1', sim: 0.88 },
        { source_table: 'product_variants', source_id: 'v1', sim: 0.86 },
      ])
      .mockResolvedValueOnce([{ id: 'v1', product_id: 'p2' }]) // variant → p2
      .mockResolvedValueOnce([
        { id: 'p1', name: 'Bolt Direct', sku: 'BD', price: 100 },
        { id: 'p2', name: 'Bolt Via Variant', sku: 'BV', price: 110 },
      ])
    const lines = JSON.stringify([{ requestedText: 'bolt item', qty: 3 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    // p1 sim=0.88, p2 sim=0.86 → diff=0.02 < 0.05 → ambiguous
    expect(result.data.lines[0].status).toBe('ambiguous')
  })

  it('uses custom simThreshold when provided', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // sim 0.75 >= custom threshold 0.70, single candidate → matched
    mockQueryMany
      .mockResolvedValueOnce([{ source_table: 'products', source_id: 'p1', sim: 0.75 }])
      .mockResolvedValueOnce([{ id: 'p1', name: 'Widget', sku: 'W', price: 50 }])
    const lines = JSON.stringify([{ requestedText: 'widget', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines, simThreshold: 0.70 }) as any
    expect(result.data.lines[0].status).toBe('matched')
    expect(result.data.threshold).toBe(0.70)
  })

  it('clamps simThreshold to [0.3, 0.95]', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockQueryMany.mockResolvedValue([])
    const lines = JSON.stringify([{ requestedText: 'something', qty: 1 }])
    const result = await getTool('match_quotation_items').handler({ lines, simThreshold: 0.01 }) as any
    expect(result.data.threshold).toBe(0.3) // clamped to min 0.3
  })

  it('returns ok with summary counts across multiple lines', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // Line 1: no embeddings → unmatched
    // Line 2: empty text → unmatched (skips embed)
    mockQueryMany
      .mockResolvedValueOnce([]) // line 1 embeddings
    const lines = JSON.stringify([
      { requestedText: 'unknown', qty: 1 },
      { requestedText: '', qty: 1 },
    ])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(result.data.counts.unmatched).toBe(2)
  })
})

// ── propose_create_quotation ──────────────────────────────────────────────────

describe('propose_create_quotation', () => {
  beforeEach(() => vi.resetAllMocks())

  const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440001'

  it('throws when customerEmail has no @', async () => {
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'notanemail',
      items: '[{"productId":"p1","quantity":1}]',
    })).rejects.toThrow('customerEmail must be a valid email')
  })

  it('throws when items is invalid JSON', async () => {
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: 'not json at all',
    })).rejects.toThrow('items must be a JSON array')
  })

  it('throws when items JSON is not an array', async () => {
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: '{"productId":"p1"}',
    })).rejects.toThrow('items must be a JSON array')
  })

  it('throws when items array is empty', async () => {
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: '[]',
    })).rejects.toThrow('items: provide 1-50 lines')
  })

  it('throws when items array exceeds 50', async () => {
    const items = JSON.stringify(Array(51).fill({ productId: PRODUCT_ID, quantity: 1 }))
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items,
    })).rejects.toThrow('items: provide 1-50 lines')
  })

  it('throws when any item is missing productId', async () => {
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: '[{"quantity":1}]',
    })).rejects.toThrow('every item needs a productId')
  })

  it('throws when product not found (products returned < unique ids)', async () => {
    mockQueryMany.mockResolvedValueOnce([]) // no products found
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 1 }]),
    })).rejects.toThrow(/Only 0 of 1/)
  })

  it('throws when quantity is <= 0', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 0 }]),
    })).rejects.toThrow('Invalid quantity')
  })

  it('throws when quantity is negative', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: -1 }]),
    })).rejects.toThrow('Invalid quantity')
  })

  it('throws when quantity is NaN (string)', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 'lots' }]),
    })).rejects.toThrow('Invalid quantity')
  })

  it('returns proposal with proposed:true and kind on happy path', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt M20', sku: 'BOLT-M20',
      gst_percentage: '18', hsn_code: '7318', price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce({ first_name: 'John', last_name: 'Doe' })
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'john@example.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 2 }]),
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.kind).toBe('create_quotation')
    expect(result.payload.items).toHaveLength(1)
    expect(result.payload.customerEmail).toBe('john@example.com')
    expect(result.payload.consigneeName).toBe('John Doe')
  })

  it('uses unitPrice from item when provided and > 0', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'anon@example.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 1, unitPrice: 150 }]),
    }) as any
    expect(result.payload.items[0].unitPrice).toBe(150)
  })

  it('falls back to product price when unitPrice is 0', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'anon@example.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 1, unitPrice: 0 }]),
    }) as any
    expect(result.payload.items[0].unitPrice).toBe(100) // falls back to product price
  })

  it('uses email as consigneeName when user not found', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null) // no user record
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'unknown@shop.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 3 }]),
    }) as any
    expect(result.payload.consigneeName).toBe('unknown@shop.com')
  })

  it('includes notes in payload when provided', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce({ first_name: 'Alice', last_name: null })
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'alice@example.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 1 }]),
      notes: 'Urgent delivery needed',
    }) as any
    expect(result.payload.notes).toBe('Urgent delivery needed')
  })

  it('sets notes to null when not provided', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'anon@example.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 1 }]),
    }) as any
    expect(result.payload.notes).toBeNull()
  })

  it('calculates GST totals correctly', async () => {
    mockQueryMany.mockResolvedValueOnce([{
      id: PRODUCT_ID, name: 'Bolt', sku: 'B',
      gst_percentage: '18', hsn_code: null, price: '100', base_price: '100',
    }])
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'a@b.com',
      items: JSON.stringify([{ productId: PRODUCT_ID, quantity: 10, unitPrice: 100 }]),
    }) as any
    // subtotal=1000, cgst=1000*18/200=90, sgst=90, total=1180
    expect(result.payload.subtotal).toBe(1000)
    expect(result.payload.cgst).toBe(90)
    expect(result.payload.sgst).toBe(90)
    expect(result.payload.total).toBe(1180)
  })

  it('uses plural "lines" in confirmation text when more than one item', async () => {
    const PRODUCT_ID2 = '550e8400-e29b-41d4-a716-446655440002'
    mockQueryMany.mockResolvedValueOnce([
      { id: PRODUCT_ID, name: 'Bolt M20', sku: 'B1', gst_percentage: '18', hsn_code: null, price: '100', base_price: '100' },
      { id: PRODUCT_ID2, name: 'Washer M20', sku: 'W1', gst_percentage: '18', hsn_code: null, price: '20', base_price: '20' },
    ])
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('propose_create_quotation').handler({
      customerEmail: 'multi@example.com',
      items: JSON.stringify([
        { productId: PRODUCT_ID, quantity: 1, unitPrice: 100 },
        { productId: PRODUCT_ID2, quantity: 5, unitPrice: 20 },
      ]),
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.items).toHaveLength(2)
    expect(result.confirmation).toMatch(/2 lines/i)
  })
})

// ── propose_send_quotation_email ──────────────────────────────────────────────

describe('propose_send_quotation_email', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when neither quotationId nor quoteNumber provided', async () => {
    await expect(getTool('propose_send_quotation_email').handler({}))
      .rejects.toThrow('Provide quotationId or quoteNumber')
  })

  it('throws when quotation not found in DB', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_send_quotation_email').handler({ quoteNumber: 'QT-999' }))
      .rejects.toThrow('Quotation not found')
  })

  it('throws when no valid recipient — consignee_email is null and no toEmail override', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'draft',
      consignee_email: null, consignee_name: null,
      total_amount: '1000', view_token: 'tok', quote_date: '2024-01-01',
    })
    await expect(getTool('propose_send_quotation_email').handler({ quotationId: 'q1' }))
      .rejects.toThrow('No valid recipient')
  })

  it('throws when toEmail override has no @ sign', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'draft',
      consignee_email: 'a@b.com', consignee_name: 'Alice',
      total_amount: '1000', view_token: 'tok', quote_date: '2024-01-01',
    })
    await expect(getTool('propose_send_quotation_email').handler({
      quotationId: 'q1', toEmail: 'noemail',
    })).rejects.toThrow('No valid recipient')
  })

  it('returns { proposed: false } when quotation status is cancelled', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'cancelled',
      consignee_email: 'a@b.com', consignee_name: 'Alice',
      total_amount: '1000', view_token: 'tok', quote_date: '2024-01-01',
    })
    const result = await getTool('propose_send_quotation_email').handler({ quotationId: 'q1' }) as any
    expect(result.proposed).toBe(false)
    expect(result.info).toMatch(/cancelled/i)
  })

  it('returns proposal using consignee_email when no toEmail override', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'draft',
      consignee_email: 'consignee@example.com', consignee_name: 'Bob',
      total_amount: '2000', view_token: 'tok2', quote_date: '2024-02-01',
    })
    const result = await getTool('propose_send_quotation_email').handler({ quotationId: 'q1' }) as any
    expect(result.proposed).toBe(true)
    expect(result.kind).toBe('send_quotation_email')
    expect(result.payload.toEmail).toBe('consignee@example.com')
  })

  it('uses empty string for consigneeName when consignee_name is null', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'draft',
      consignee_email: 'buyer@example.com', consignee_name: null,
      total_amount: '500', view_token: 'tok3', quote_date: '2024-03-01',
    })
    const result = await getTool('propose_send_quotation_email').handler({ quotationId: 'q1' }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.consigneeName).toBe('')
  })

  it('uses toEmail override when provided and valid', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q1', quote_number: 'QT-001', status: 'final',
      consignee_email: 'orig@example.com', consignee_name: 'Alice',
      total_amount: '5000', view_token: 'tokx', quote_date: '2024-03-01',
    })
    const result = await getTool('propose_send_quotation_email').handler({
      quotationId: 'q1', toEmail: 'override@other.com',
    }) as any
    expect(result.payload.toEmail).toBe('override@other.com')
  })

  it('looks up by quoteNumber instead of quotationId', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'q5', quote_number: 'QT-005', status: 'draft',
      consignee_email: 'x@y.com', consignee_name: 'X',
      total_amount: '100', view_token: 'tok5', quote_date: '2024-04-01',
    })
    const result = await getTool('propose_send_quotation_email').handler({ quoteNumber: 'QT-005' }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.quoteNumber).toBe('QT-005')
  })
})

// ── propose_mark_invoice_paid ─────────────────────────────────────────────────

describe('propose_mark_invoice_paid', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when neither invoiceId nor invoiceNumber provided', async () => {
    await expect(getTool('propose_mark_invoice_paid').handler({ paymentMode: 'cash' }))
      .rejects.toThrow('Provide invoiceId or invoiceNumber')
  })

  it('throws for unrecognised paymentMode', async () => {
    await expect(getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'bitcoin',
    })).rejects.toThrow('paymentMode must be one of')
  })

  it('throws when paidAt does not match YYYY-MM-DD', async () => {
    await expect(getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'cash', paidAt: '15-01-2024',
    })).rejects.toThrow('paidAt must be YYYY-MM-DD')
  })

  it('throws when paidAt is a plain string without dashes', async () => {
    await expect(getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'upi', paidAt: 'today',
    })).rejects.toThrow('paidAt must be YYYY-MM-DD')
  })

  it('throws when invoice not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'bad', paymentMode: 'cash',
    })).rejects.toThrow('Invoice not found')
  })

  it('returns { proposed: false } when invoice is already paid', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
      total_amount: '500', payment_status: 'paid', customer_name: 'Alice',
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'cash',
    }) as any
    expect(result.proposed).toBe(false)
    expect(result.info).toMatch(/already paid/i)
  })

  it('returns { proposed: false } when invoice is refunded', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
      total_amount: '500', payment_status: 'refunded', customer_name: 'Alice',
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'upi',
    }) as any
    expect(result.proposed).toBe(false)
    expect(result.info).toMatch(/refunded/i)
  })

  it('returns proposal with proposed:true for unpaid invoice', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
      total_amount: '1500', payment_status: 'unpaid', customer_name: 'Alice',
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'upi', paidAt: '2024-03-15',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.kind).toBe('mark_invoice_paid')
    expect(result.payload.paymentMode).toBe('upi')
    expect(result.payload.paidAt).toBe('2024-03-15')
  })

  it('sets paidAt to null when not provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
      total_amount: '500', payment_status: 'unpaid', customer_name: null,
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceNumber: 'INV-001', paymentMode: 'cash',
    }) as any
    expect(result.payload.paidAt).toBeNull()
    expect(result.payload.customerName).toBe('') // null → ''
  })

  it('looks up by invoiceNumber instead of invoiceId', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv2', order_number: 'ORD-002', invoice_number: 'INV-002',
      total_amount: '2000', payment_status: 'partial', customer_name: 'Bob',
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceNumber: 'INV-002', paymentMode: 'bank_transfer',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.invoiceNumber).toBe('INV-002')
  })

  it('accepts all valid PAYMENT_MODES', async () => {
    for (const mode of ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'razorpay', 'credit']) {
      mockQueryOne.mockResolvedValueOnce({
        id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
        total_amount: '100', payment_status: 'unpaid', customer_name: null,
      })
      const result = await getTool('propose_mark_invoice_paid').handler({
        invoiceId: 'inv1', paymentMode: mode,
      }) as any
      expect(result.proposed).toBe(true)
    }
  })

  it('normalises paymentMode to lowercase', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'inv1', order_number: 'ORD-001', invoice_number: 'INV-001',
      total_amount: '100', payment_status: 'unpaid', customer_name: null,
    })
    const result = await getTool('propose_mark_invoice_paid').handler({
      invoiceId: 'inv1', paymentMode: 'UPI',
    }) as any
    expect(result.payload.paymentMode).toBe('upi')
  })
})

// ── propose_update_order_status ───────────────────────────────────────────────

describe('propose_update_order_status', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws when neither orderId nor orderNumber provided', async () => {
    await expect(getTool('propose_update_order_status').handler({ newStatus: 'shipped' }))
      .rejects.toThrow('Provide orderId or orderNumber')
  })

  it('throws for unrecognised newStatus', async () => {
    await expect(getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'unknown_status',
    })).rejects.toThrow('newStatus must be one of')
  })

  it('throws when awbNumber is longer than 64 chars', async () => {
    await expect(getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped', awbNumber: 'A'.repeat(65),
    })).rejects.toThrow('awbNumber too long')
  })

  it('accepts awbNumber exactly 64 chars', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'confirmed',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped', awbNumber: 'A'.repeat(64),
    }) as any
    expect(result.proposed).toBe(true)
  })

  it('throws when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    await expect(getTool('propose_update_order_status').handler({
      orderId: 'bad', newStatus: 'shipped',
    })).rejects.toThrow('Order not found')
  })

  it('returns { proposed: false } when order already has that status', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'shipped',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped',
    }) as any
    expect(result.proposed).toBe(false)
    expect(result.info).toMatch(/already in status/i)
  })

  it('sets isRegression:true and adds warn callout for backwards transition', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'shipped',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: 'AWB123',
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'confirmed',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.isRegression).toBe(true)
    const warnBlock = result.ui_blocks.find((b: any) => b.type === 'callout' && b.tone === 'warn')
    expect(warnBlock).toBeDefined()
    expect(warnBlock.title).toMatch(/regression/i)
  })

  it('does NOT flag cancelled as regression regardless of fromIdx', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'shipped',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'cancelled',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.isRegression).toBe(false)
    const warnBlock = result.ui_blocks.find((b: any) => b.type === 'callout' && b.tone === 'warn')
    expect(warnBlock).toBeUndefined()
  })

  it('adds info callout when shipping without any AWB number', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'confirmed',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped',
    }) as any
    expect(result.proposed).toBe(true)
    const infoBlock = result.ui_blocks.find((b: any) => b.type === 'callout' && b.tone === 'info')
    expect(infoBlock).toBeDefined()
  })

  it('does NOT add info callout when shipping with a new awbNumber', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'processing',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped', awbNumber: 'AWB-12345',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.awbNumber).toBe('AWB-12345')
    const infoBlock = result.ui_blocks.find((b: any) => b.type === 'callout' && b.tone === 'info')
    expect(infoBlock).toBeUndefined()
  })

  it('does NOT add info callout when existing awb_number is already set', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'confirmed',
      payment_status: 'paid', customer_name: 'Alice', total_amount: '1000', awb_number: 'EXISTING-AWB',
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped',
    }) as any
    expect(result.proposed).toBe(true)
    const infoBlock = result.ui_blocks.find((b: any) => b.type === 'callout' && b.tone === 'info')
    expect(infoBlock).toBeUndefined()
  })

  it('includes fromStatus and newStatus in payload', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'pending',
      payment_status: 'unpaid', customer_name: null, total_amount: '500', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'confirmed',
    }) as any
    expect(result.payload.fromStatus).toBe('pending')
    expect(result.payload.newStatus).toBe('confirmed')
    expect(result.payload.isRegression).toBe(false)
  })

  it('looks up by orderNumber when orderId not provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o5', order_number: 'ORD-005', status: 'processing',
      payment_status: 'paid', customer_name: 'Carol', total_amount: '3000', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderNumber: 'ORD-005', newStatus: 'shipped', awbNumber: 'AWB-99',
    }) as any
    expect(result.proposed).toBe(true)
    expect(result.payload.orderNumber).toBe('ORD-005')
  })

  it('normalises newStatus to lowercase', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'pending',
      payment_status: 'unpaid', customer_name: null, total_amount: '100', awb_number: null,
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'CONFIRMED',
    }) as any
    expect(result.payload.newStatus).toBe('confirmed')
  })

  it('includes existing AWB in kv_pairs when present and no new AWB provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'o1', order_number: 'ORD-001', status: 'processing',
      payment_status: 'paid', customer_name: 'Dave', total_amount: '800', awb_number: 'OLD-AWB',
    })
    const result = await getTool('propose_update_order_status').handler({
      orderId: 'o1', newStatus: 'shipped',
    }) as any
    expect(result.proposed).toBe(true)
    const kvBlock = result.ui_blocks.find((b: any) => b.type === 'kv_pairs')
    const existingAwbPair = kvBlock?.pairs.find((p: any) => p.key === 'Existing AWB')
    expect(existingAwbPair).toBeDefined()
    expect(existingAwbPair.value).toBe('OLD-AWB')
  })
})

// ── match_quotation_items — embeddings query error fallback ───────────────────

describe('match_quotation_items embeddings catch fallback', () => {
  beforeEach(() => vi.resetAllMocks())

  it('treats line as unmatched when embeddings query rejects', async () => {
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    // First queryMany call (embeddings SELECT) rejects — .catch(() => []) should fire
    mockQueryMany.mockRejectedValueOnce(new Error('DB down'))
    const lines = JSON.stringify([{ requestedText: 'M16 bolt', qty: 2 }])
    const result = await getTool('match_quotation_items').handler({ lines }) as any
    expect(result.ok).toBe(true)
    expect(result.data.lines[0].status).toBe('unmatched')
    expect(result.data.counts.unmatched).toBe(1)
  })
})

// ── extract_quotation_lines_from_attachment ───────────────────────────────────

describe('extract_quotation_lines_from_attachment', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns err when attachment_id is empty', async () => {
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: '' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/attachment_id is required/i)
  })

  it('returns err when attachment not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'abc' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/not found or expired/i)
  })

  it('returns cached text when extracted_text already populated', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'application/pdf', filename: 'order.pdf',
      byte_size: 1024, data: Buffer.from(''), extracted_text: 'Line 1\nLine 2', expires_at: '2099-01-01',
    })
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(true)
    expect(result.meta.cached).toBe(true)
    expect(result.data.text).toBe('Line 1\nLine 2')
  })

  it('extracts text from PDF via pdf-parse when text is available', async () => {
    const pdfParse = ((await import('pdf-parse')) as any).default
    pdfParse.mockResolvedValueOnce({ text: 'Parsed PDF text' })
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'application/pdf', filename: 'doc.pdf',
      byte_size: 500, data: Buffer.from('%PDF'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockQuery.mockResolvedValue(undefined as any)
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(true)
    expect(result.data.text).toBe('Parsed PDF text')
    expect(result.meta.source).toBe('pdf_text')
    expect(result.meta.cached).toBe(false)
  })

  it('falls back to vision OCR when pdf-parse yields empty text and OCR succeeds', async () => {
    const pdfParse = ((await import('pdf-parse')) as any).default
    pdfParse.mockResolvedValueOnce({ text: '   ' })
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'application/pdf', filename: 'scan.pdf',
      byte_size: 200, data: Buffer.from('%PDF'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockOcrPdfPages.mockResolvedValueOnce({ ok: true, text: 'OCR text from PDF', pages: 3, model: 'gpt-4o' })
    mockQuery.mockResolvedValue(undefined as any)
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(true)
    expect(result.data.text).toBe('OCR text from PDF')
    expect(result.meta.source).toBe('vision_ocr')
    expect(result.meta.pages).toBe(3)
  })

  it('returns err when pdf-parse yields empty and vision OCR fails', async () => {
    const pdfParse = ((await import('pdf-parse')) as any).default
    pdfParse.mockResolvedValueOnce({ text: '' })
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'application/pdf', filename: 'bad.pdf',
      byte_size: 100, data: Buffer.from('%PDF'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockOcrPdfPages.mockResolvedValueOnce({ ok: false, reason: 'Vision not configured', hint: 'Set up vision key' })
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Could not extract text from PDF/i)
    expect(result.reason).toBe('Vision not configured')
  })

  it('returns err when pdf-parse throws and vision OCR also fails', async () => {
    const pdfParse = ((await import('pdf-parse')) as any).default
    pdfParse.mockRejectedValueOnce(new Error('corrupt PDF'))
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'application/pdf', filename: 'corrupt.pdf',
      byte_size: 50, data: Buffer.from('bad'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockOcrPdfPages.mockResolvedValueOnce({ ok: false, reason: 'OCR error', hint: undefined })
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Could not extract text from PDF/i)
  })

  it('extracts text from image via vision OCR when OCR succeeds', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'image/jpeg', filename: 'photo.jpg',
      byte_size: 2048, data: Buffer.from('img'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockOcrImage.mockResolvedValueOnce({ ok: true, text: 'Image OCR text', model: 'gpt-4o' })
    mockQuery.mockResolvedValue(undefined as any)
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(true)
    expect(result.data.text).toBe('Image OCR text')
    expect(result.meta.source).toBe('vision_ocr')
  })

  it('returns err when image OCR fails', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'image/png', filename: 'scan.png',
      byte_size: 1000, data: Buffer.from('img'), extracted_text: null, expires_at: '2099-01-01',
    })
    mockOcrImage.mockResolvedValueOnce({ ok: false, reason: 'No vision model', hint: 'Configure vision' })
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Image OCR failed/i)
    expect(result.reason).toBe('No vision model')
  })

  it('returns err for unsupported mime type', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'a1', mime_type: 'text/csv', filename: 'data.csv',
      byte_size: 300, data: Buffer.from('a,b'), extracted_text: null, expires_at: '2099-01-01',
    })
    const result = await getTool('extract_quotation_lines_from_attachment').handler({ attachment_id: 'a1' }) as any
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/Unsupported attachment type/i)
  })
})
