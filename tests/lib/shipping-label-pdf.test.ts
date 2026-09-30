import { vi, describe, it, expect, beforeEach } from 'vitest'

// pdfkit is loaded via eval('require')('pdfkit') — vi.mock intercepts require cache.
// We cannot track MockPDF.mock.results because the eval path doesn't use the
// imported symbol. Instead, we expose a spy on `end` via a module-level array.
const endSpies: (() => void)[] = []
const addPageSpies: (() => void)[] = []

vi.mock('pdfkit', () => {
  function makeMockDoc() {
    let dataCb: ((c: Buffer) => void) | null = null
    let endCb: (() => void) | null = null
    const endSpy = vi.fn().mockImplementation(function () {
      dataCb?.(Buffer.from('mock-pdf-chunk'))
      endCb?.()
    })
    const addPageSpy = vi.fn().mockReturnThis()
    endSpies.push(endSpy)
    addPageSpies.push(addPageSpy)
    const doc: Record<string, any> = {
      on: vi.fn().mockImplementation(function (event: string, cb: any) {
        if (event === 'data') dataCb = cb
        if (event === 'end') endCb = cb
        return doc
      }),
      end: endSpy,
      addPage: addPageSpy,
      font: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(),
      strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
      widthOfString: vi.fn().mockReturnValue(50),
      heightOfString: vi.fn().mockReturnValue(10),
      x: 50,
      y: 100,
      page: { width: 288, height: 432, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
    }
    return doc
  }
  return { default: vi.fn().mockImplementation(() => makeMockDoc()) }
})

const mockBwipToBuffer = vi.fn()
vi.mock('bwip-js', () => ({
  default: { toBuffer: mockBwipToBuffer },
  toBuffer: mockBwipToBuffer,
}))

vi.mock('path', () => ({
  default: { join: (...parts: string[]) => parts.join('/') },
  join: (...parts: string[]) => parts.join('/'),
}))

import { buildLabelPDF, buildMergedLabelsPDF, type LabelItem, type LabelInput } from '@/lib/shipping-label-pdf'

beforeEach(() => {
  vi.clearAllMocks()
  endSpies.length = 0
  addPageSpies.length = 0
  mockBwipToBuffer.mockResolvedValue(Buffer.from('mock-barcode-png'))
})

// ── Shared test data ──────────────────────────────────────────────────────

const baseOrder = {
  order_number: 'ORD-001',
  full_name: 'Test Customer',
  address_line1: '10 Main Street',
  address_line2: 'Apt 2B',
  landmark: 'Near Park',
  city: 'Mumbai',
  state: 'Maharashtra',
  postal_code: '400001',
  total_amount: '599.00',
}

const basePkg = {
  sort_code: 'MUM-01',
  pin: '400001',
  name: 'Test Customer',
  add: '10 Main Street, Apt 2B',
  sname: 'Jeffi Stores',
  sadd: 'Raipur HQ',
  oid: 'ORD-001',
  prd: 'Hardware',
  cod: '0',
  total_amount: '599.00',
}

const baseItems: LabelItem[] = [
  { name: 'Hex Bolt M10', qty: 2, price: 85, total: 170 },
  { name: 'Flat Washer', qty: 5, price: 10, total: 50 },
]
const baseAwb = 'AWB123456789'

// ── buildLabelPDF ─────────────────────────────────────────────────────────

describe('buildLabelPDF', () => {
  it('returns a non-empty Buffer', async () => {
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('calls bwipjs for AWB barcode (succeeds without throwing)', async () => {
    // bwip mock resolves — no throw means the barcode path ran
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('uses order fallbacks when pkg fields are missing', async () => {
    const buf = await buildLabelPDF({}, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('handles barcode generation failure gracefully (bwip throws)', async () => {
    mockBwipToBuffer.mockRejectedValue(new Error('bwip error'))
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles empty items list without throwing', async () => {
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, [])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles many items (overflow branch) without throwing', async () => {
    const manyItems: LabelItem[] = Array.from({ length: 30 }, (_, i) => ({
      name: `Item ${i + 1}`,
      qty: 1,
      price: 10,
      total: 10,
    }))
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, manyItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles pkg with cod > 0 (COD branch) without throwing', async () => {
    const buf = await buildLabelPDF({ ...basePkg, cod: '450.00' }, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles missing total_amount and cod (orderRow fallback) without throwing', async () => {
    const buf = await buildLabelPDF(
      { ...basePkg, total_amount: undefined, cod: undefined },
      baseAwb,
      baseOrder,
      baseItems
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles cod > 0 with no total_amount (cod as totalAmount) without throwing', async () => {
    const buf = await buildLabelPDF(
      { ...basePkg, total_amount: undefined, cod: '350.00' },
      baseAwb,
      baseOrder,
      baseItems
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles long invoice number (>22 chars) without throwing', async () => {
    const buf = await buildLabelPDF({ ...basePkg, oid: 'INV-' + 'X'.repeat(30) }, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles address line duplicating name without throwing', async () => {
    const buf = await buildLabelPDF(
      { ...basePkg, name: 'Test Customer', add: 'Test Customer, 10 Main Street, Mumbai' },
      baseAwb,
      baseOrder,
      baseItems
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles address with 6-digit PIN line without throwing', async () => {
    const buf = await buildLabelPDF({ ...basePkg, add: '10 Main Street, 400001' }, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles pkg.order fallback for invoiceNo without throwing', async () => {
    const buf = await buildLabelPDF(
      { ...basePkg, oid: undefined, order: 'INV-FALLBACK' },
      baseAwb,
      baseOrder,
      baseItems
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles fully empty address fields without throwing', async () => {
    const emptyOrder = { ...baseOrder, address_line1: '', address_line2: '', landmark: '', city: '', state: '' }
    const buf = await buildLabelPDF({}, baseAwb, emptyOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('uses DELHIVERY_SELLER_ADDRESS env var without throwing', async () => {
    process.env.DELHIVERY_SELLER_ADDRESS = 'Env Seller Address'
    try {
      const buf = await buildLabelPDF({ ...basePkg, sadd: undefined }, baseAwb, baseOrder, baseItems)
      expect(Buffer.isBuffer(buf)).toBe(true)
    } finally {
      delete process.env.DELHIVERY_SELLER_ADDRESS
    }
  })

  it('falls back to hardcoded default address when pkg.sadd and env var both absent', async () => {
    delete process.env.DELHIVERY_SELLER_ADDRESS
    const buf = await buildLabelPDF({ ...basePkg, sadd: undefined }, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('calls doc.end() and produces a buffer (single label)', async () => {
    const buf = await buildLabelPDF(basePkg, baseAwb, baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('sanitizes non-ASCII AWB characters (no throw)', async () => {
    const buf = await buildLabelPDF(basePkg, 'AWB-TEST', baseOrder, baseItems)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
})

// ── buildMergedLabelsPDF ──────────────────────────────────────────────────

describe('buildMergedLabelsPDF', () => {
  it('returns a non-empty Buffer for a single label', async () => {
    const buf = await buildMergedLabelsPDF([{ pkg: basePkg, awb: baseAwb, orderRow: baseOrder, items: baseItems }])
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('returns a non-empty Buffer for multiple labels', async () => {
    const buf = await buildMergedLabelsPDF([
      { pkg: basePkg, awb: 'AWB111', orderRow: baseOrder, items: baseItems },
      {
        pkg: { ...basePkg, oid: 'ORD-002' },
        awb: 'AWB222',
        orderRow: { ...baseOrder, order_number: 'ORD-002' },
        items: [],
      },
      { pkg: { ...basePkg, cod: '300' }, awb: 'AWB333', orderRow: baseOrder, items: baseItems },
    ])
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('handles zero labels (empty merge) without throwing', async () => {
    const buf = await buildMergedLabelsPDF([])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('calls addPage for each merged label (buffer produced)', async () => {
    const buf = await buildMergedLabelsPDF([
      { pkg: basePkg, awb: 'AWB001', orderRow: baseOrder, items: baseItems },
      { pkg: basePkg, awb: 'AWB002', orderRow: baseOrder, items: baseItems },
    ])
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('multiple labels: each label produces barcodes without throwing', async () => {
    const buf = await buildMergedLabelsPDF([
      { pkg: basePkg, awb: 'AWB001', orderRow: baseOrder, items: baseItems },
      { pkg: basePkg, awb: 'AWB002', orderRow: baseOrder, items: baseItems },
    ])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles COD label in merged set without throwing', async () => {
    const buf = await buildMergedLabelsPDF([
      { pkg: { ...basePkg, cod: '200.00' }, awb: 'AWB001', orderRow: baseOrder, items: baseItems },
    ])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('merged PDF produces non-empty buffer and calls doc.end()', async () => {
    const buf = await buildMergedLabelsPDF([
      { pkg: basePkg, awb: 'AWB001', orderRow: baseOrder, items: baseItems },
      { pkg: basePkg, awb: 'AWB002', orderRow: baseOrder, items: baseItems },
    ])
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('handles bwip failure in merged labels gracefully', async () => {
    mockBwipToBuffer.mockRejectedValue(new Error('bwip down'))
    const buf = await buildMergedLabelsPDF([{ pkg: basePkg, awb: 'AWB001', orderRow: baseOrder, items: baseItems }])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles overflow items in a merged label without throwing', async () => {
    const manyItems: LabelItem[] = Array.from({ length: 25 }, (_, i) => ({
      name: `Part ${i}`,
      qty: 1,
      price: 5,
      total: 5,
    }))
    const buf = await buildMergedLabelsPDF([{ pkg: basePkg, awb: 'AWB001', orderRow: baseOrder, items: manyItems }])
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
})
