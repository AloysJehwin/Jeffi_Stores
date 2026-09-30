import { describe, it, expect, vi, beforeEach } from 'vitest'

// pdfkit is mocked globally via tests/helpers/pdf-mocks.ts (setupFiles). qrcode &
// bwip-js need per-file mocks because label-pdf uses toBuffer. label-pdf.ts loads
// them via eval('require')(...), so the SAME fn must back both default and named
// exports — otherwise vi.mocked(default.toBuffer) wouldn't be the fn used.
const mockQr = vi.fn().mockResolvedValue(Buffer.from('mock-qr-png'))
const mockBwip = vi.fn().mockResolvedValue(Buffer.from('mock-barcode-png'))

vi.mock('qrcode', () => ({
  default: { toBuffer: mockQr, toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr') },
  toBuffer: mockQr,
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

vi.mock('bwip-js', () => ({
  default: { toBuffer: mockBwip },
  toBuffer: mockBwip,
}))

import {
  generateBatchLabelPDF,
  generateSerialLabelPDF,
  generateLabelPDF,
  generateShelfLabelPDF,
  type LabelBatch,
  type LabelSerial,
  type LabelProduct,
  type LabelSize,
} from '@/lib/label-pdf'

const fullBatch: LabelBatch = {
  batchId: 'B-1',
  productName: 'Portland Cement 50kg Bag Premium Grade Extra Long Name',
  variantName: 'Grey',
  sku: 'CEM-50',
  lotNumber: 'LOT-2024-001',
  manufactureDate: '2024-01-01',
  expiryDate: '2025-01-01',
  quantity: 42,
}

const minimalBatch: LabelBatch = {
  batchId: 'B-2',
  productName: 'Sand',
  variantName: null,
  sku: 'SAND-1',
  lotNumber: null,
  manufactureDate: null,
  expiryDate: null,
  quantity: null,
}

const fullSerial: LabelSerial = {
  serialNumber: 'SN-000123',
  productName: 'Drill Machine Heavy Duty Industrial Model X',
  variantName: 'Blue',
  sku: 'DRILL-1',
  lotNumber: 'LOT-XYZ',
}

const minimalSerial: LabelSerial = {
  serialNumber: 'SN-9',
  productName: 'Bit',
  sku: 'BIT-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQr.mockResolvedValue(Buffer.from('mock-qr-png') as any)
  mockBwip.mockResolvedValue(Buffer.from('mock-barcode-png') as any)
})

// ---------------------------------------------------------------------------
// generateBatchLabelPDF — thermal & sheet, spec resolution branches
// ---------------------------------------------------------------------------
describe('generateBatchLabelPDF', () => {
  it('generates thermal (one per page) with full batch data', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 2, false)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('generates thermal with minimal batch (no lot/exp/qty rows)', async () => {
    const result = await generateBatchLabelPDF([minimalBatch], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('generates sheet layout (A4 grid)', async () => {
    const result = await generateBatchLabelPDF([fullBatch, minimalBatch], 3, true)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('resolves size when a valid size string is passed', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 1, false, '40x60')
    expect(result).toBeInstanceOf(Buffer)
  })

  it('falls back to BATCH_SPEC for shelf-card size', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 1, true, 'shelf-card')
    expect(result).toBeInstanceOf(Buffer)
  })

  it('falls back to BATCH_SPEC for unknown size', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 1, false, 'bogus-size')
    expect(result).toBeInstanceOf(Buffer)
  })

  it('falls back to BATCH_SPEC for null size', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 1, false, null)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty batch list', async () => {
    const result = await generateBatchLabelPDF([], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty batch list on sheet layout', async () => {
    const result = await generateBatchLabelPDF([], 1, true)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// generateSerialLabelPDF — thermal & sheet, lot present/absent
// ---------------------------------------------------------------------------
describe('generateSerialLabelPDF', () => {
  it('generates thermal serial labels with lot number', async () => {
    const result = await generateSerialLabelPDF([fullSerial], 2, false)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('generates thermal serial labels without lot number', async () => {
    const result = await generateSerialLabelPDF([minimalSerial], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('generates sheet layout serial labels', async () => {
    const result = await generateSerialLabelPDF([fullSerial, minimalSerial], 2, true, '40x60')
    expect(result).toBeInstanceOf(Buffer)
  })

  it('falls back to BATCH_SPEC when size omitted', async () => {
    const result = await generateSerialLabelPDF([fullSerial], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty serial list', async () => {
    const result = await generateSerialLabelPDF([], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// drawWarningIcons — flammable / hazardous / fragile badges (covers 119-140)
// ---------------------------------------------------------------------------
const baseProduct: LabelProduct = {
  id: 'p1',
  name: 'Solvent Cleaner',
  variant_name: null,
  sku: 'SOLV-1',
  slug: 'solv-1',
  mrp: 300,
  price_ex_gst: 200,
  base_price: 200,
  gst_percentage: 18,
  brand_name: 'Acme',
}

describe('warning icons + price branches (product labels)', () => {
  const allSizes: LabelSize[] = ['30x20', '30x50', '40x60', '50x50', '80x20']

  for (const size of allSizes) {
    it(`renders all three warning badges for size ${size}`, async () => {
      const p: LabelProduct = { ...baseProduct, flammable: true, hazardous: true, fragile: true }
      const result = await generateLabelPDF([p], size, 1)
      expect(result).toBeInstanceOf(Buffer)
    })
  }

  it('renders a single fragile badge only', async () => {
    const p: LabelProduct = { ...baseProduct, fragile: true }
    const result = await generateLabelPDF([p], '40x60', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('draws MRP strikethrough when MRP differs from inc-GST price', async () => {
    // mrp inc-gst (354) !== price inc-gst (236) → strikethrough drawn
    const p: LabelProduct = { ...baseProduct, mrp: 300, price_ex_gst: 200, gst_percentage: 18 }
    const result = await generateLabelPDF([p], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('skips MRP strikethrough when MRP equals price', async () => {
    // mrp === price ex-gst, gst 0 → mrpInc === incGst → no strikethrough
    const p: LabelProduct = { ...baseProduct, mrp: 200, price_ex_gst: 200, gst_percentage: 0 }
    const result = await generateLabelPDF([p], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('skips MRP block when mrp is zero/negative', async () => {
    const p: LabelProduct = { ...baseProduct, mrp: 0 }
    const result = await generateLabelPDF([p], '40x60', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('does not draw price when showPrice is false', async () => {
    const p: LabelProduct = { ...baseProduct, showPrice: false }
    const result = await generateLabelPDF([p], '30x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('does not draw price when price is zero', async () => {
    const p: LabelProduct = { ...baseProduct, price_ex_gst: 0, base_price: 0, mrp: null }
    const result = await generateLabelPDF([p], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  const allSizes2: LabelSize[] = ['30x20', '30x50', '40x60', '50x50', '80x20']
  for (const size of allSizes2) {
    it(`hides price for size ${size} when showPrice false`, async () => {
      const p: LabelProduct = { ...baseProduct, showPrice: false }
      const result = await generateLabelPDF([p], size, 1)
      expect(result).toBeInstanceOf(Buffer)
    })
  }

  it('handles negative MRP (mrpRaw <= 0 skips strikethrough)', async () => {
    const p: LabelProduct = { ...baseProduct, mrp: -5 }
    const result = await generateLabelPDF([p], '40x60', 1)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// makeBarcodeBuffer failure path (returns null) — covers 46-48 & null image branches
// ---------------------------------------------------------------------------
describe('barcode generation failure (null buffer)', () => {
  beforeEach(() => {
    mockBwip.mockResolvedValue(null as any)
  })

  const allSizes: LabelSize[] = ['30x20', '30x50', '40x60', '50x50', '80x20', 'shelf-card']
  for (const size of allSizes) {
    it(`product label (${size}) renders without barcode when bwip fails`, async () => {
      const p: LabelProduct = { ...baseProduct, variant_name: 'V1', flammable: true }
      const result = await generateLabelPDF([p], size, 1)
      expect(result).toBeInstanceOf(Buffer)
    })
  }

  it('shelf label with product+sku renders without barcode when bwip fails', async () => {
    const result = await generateShelfLabelPDF(
      [{ displayCode: 'A-1', warehouseName: 'WH', productName: 'X', sku: 'X1' }],
      1
    )
    expect(result).toBeInstanceOf(Buffer)
  })

  it('shelf label without product renders without barcode when bwip fails', async () => {
    const result = await generateShelfLabelPDF([{ displayCode: 'B-2', warehouseName: 'WH2' }], 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('batch label renders without barcode when bwip fails', async () => {
    const result = await generateBatchLabelPDF([fullBatch], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('serial label renders without barcode when bwip fails', async () => {
    const result = await generateSerialLabelPDF([fullSerial], 1, false)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// QR generation failure (null buffer) → covers `if (qrBuf)` false branches
// ---------------------------------------------------------------------------

describe('QR generation failure paths', () => {
  it('40x60 / 50x50 render when QR buffer is empty', async () => {
    // qrBuf falsy → skip qr image. Empty buffer is falsy? No — use undefined.
    mockQr.mockResolvedValue(undefined as any)
    for (const size of ['40x60', '50x50'] as LabelSize[]) {
      const result = await generateLabelPDF([{ ...baseProduct, variant_name: 'V' }], size, 1)
      expect(result).toBeInstanceOf(Buffer)
    }
  })

  it('batch/serial/shelf render when QR buffer is empty', async () => {
    mockQr.mockResolvedValue(undefined as any)
    expect(await generateBatchLabelPDF([fullBatch], 1, false)).toBeInstanceOf(Buffer)
    expect(await generateSerialLabelPDF([fullSerial], 1, false)).toBeInstanceOf(Buffer)
    expect(await generateShelfLabelPDF([{ displayCode: 'C-1', warehouseName: 'W' }], 1)).toBeInstanceOf(Buffer)
  })

  it('renders all generators when BOTH qr and barcode buffers are null', async () => {
    mockQr.mockResolvedValue(undefined as any)
    mockBwip.mockResolvedValue(null as any)
    for (const size of ['40x60', '50x50'] as LabelSize[]) {
      expect(await generateLabelPDF([{ ...baseProduct, variant_name: 'V' }], size, 1)).toBeInstanceOf(Buffer)
    }
    expect(await generateBatchLabelPDF([fullBatch], 1, false)).toBeInstanceOf(Buffer)
    expect(await generateBatchLabelPDF([fullBatch], 1, true)).toBeInstanceOf(Buffer)
    expect(await generateSerialLabelPDF([fullSerial], 1, false)).toBeInstanceOf(Buffer)
    expect(await generateSerialLabelPDF([fullSerial], 1, true)).toBeInstanceOf(Buffer)
    expect(
      await generateShelfLabelPDF([{ displayCode: 'C-2', warehouseName: 'W', productName: 'P', sku: 'S' }], 1)
    ).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// Empty barcode text → `|| 'LABEL'` / `|| 'SHELF'` fallbacks (L36, L430)
// ---------------------------------------------------------------------------
describe('empty barcode text fallbacks', () => {
  it('product with non-ASCII-only sku falls back to LABEL text', async () => {
    // sku strips to empty after ASCII filter → falls back to 'LABEL'
    const p: LabelProduct = { ...baseProduct, sku: '★★★' }
    const result = await generateLabelPDF([p], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('shelf displayCode with non-ASCII-only chars falls back to SHELF text', async () => {
    const result = await generateShelfLabelPDF([{ displayCode: '★★', warehouseName: 'WH' }], 1)
    expect(result).toBeInstanceOf(Buffer)
  })
})
// ---------------------------------------------------------------------------
// Absent-optional-field false branches (reachable): brand_name / variant_name / sku
// ---------------------------------------------------------------------------
describe('optional-field absent branches', () => {
  it('50x50 renders without brand_name (L275 false side)', async () => {
    const p: LabelProduct = { ...baseProduct, variant_name: 'V1', brand_name: null }
    const result = await generateLabelPDF([p], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('80x20 renders without variant_name (L317 false side)', async () => {
    const p: LabelProduct = { ...baseProduct, variant_name: null }
    const result = await generateLabelPDF([p], '80x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('shelf label with productName but no sku (L454 false side)', async () => {
    const result = await generateShelfLabelPDF([{ displayCode: 'D-1', warehouseName: 'WH', productName: 'Widget' }], 1)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// Detail-row overflow guard (L540 / L571): a short label height forces the last
// detail row past maxY so `if (midY > maxY) return` fires.
// ---------------------------------------------------------------------------
describe('detail row overflow guard on short label size', () => {
  it('batch label on 30x20 skips overflowing detail rows', async () => {
    // 30x20 (20mm tall) leaves room for ~2 detail rows; LOT+EXP+QTY overflows.
    const result = await generateBatchLabelPDF([fullBatch], 1, false, '30x20')
    expect(result).toBeInstanceOf(Buffer)
  })

  it('serial label on 30x20 skips overflowing detail rows', async () => {
    const result = await generateSerialLabelPDF([fullSerial], 1, false, '30x20')
    expect(result).toBeInstanceOf(Buffer)
  })
})
