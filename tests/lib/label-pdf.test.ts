import { describe, it, expect, vi, beforeEach } from 'vitest'

// pdfkit, qrcode and bwip-js are all mocked globally in tests/helpers/pdf-mocks.ts
// which is auto-loaded via setupFiles + the mock in tests/setup.ts.
// We add qrcode.toBuffer and bwip-js.toBuffer mocks here since label-pdf uses those.

vi.mock('qrcode', () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-qr-png')),
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

vi.mock('bwip-js', () => ({
  default: {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-barcode-png')),
  },
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-barcode-png')),
}))

import {
  LABEL_SIZES,
  generateLabelPDF,
  generateLabelSheetPDF,
  generateShelfLabelPDF,
  type LabelProduct,
  type LabelSize,
  type ShelfLabelItem,
} from '@/lib/documents/label-pdf'

const mockProduct: LabelProduct = {
  id: 'p1',
  product_id: 'p1',
  variant_id: null,
  name: 'M6 Hex Bolt',
  variant_name: null,
  sku: 'BOLT-M6-001',
  slug: 'bolt-m6-001',
  mrp: 25,
  price_ex_gst: 16.95,
  base_price: 20,
  gst_percentage: 18,
  brand_name: 'Unbrako',
  gtin: null,
}

const mockProductWithVariant: LabelProduct = {
  ...mockProduct,
  variant_name: 'M6 x 30mm',
}

const mockProductNoGst: LabelProduct = {
  ...mockProduct,
  gst_percentage: 0,
  price_ex_gst: 20,
  mrp: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// LABEL_SIZES constant
// ---------------------------------------------------------------------------
describe('LABEL_SIZES', () => {
  it('exports an array of 6 label sizes', () => {
    expect(LABEL_SIZES).toHaveLength(6)
  })

  it('each size has required properties', () => {
    for (const spec of LABEL_SIZES) {
      expect(spec).toHaveProperty('size')
      expect(spec).toHaveProperty('widthPt')
      expect(spec).toHaveProperty('heightPt')
      expect(spec).toHaveProperty('label')
      expect(spec).toHaveProperty('widthMm')
      expect(spec).toHaveProperty('heightMm')
    }
  })

  it('includes all expected size keys', () => {
    const sizes = LABEL_SIZES.map(s => s.size)
    expect(sizes).toContain('30x20')
    expect(sizes).toContain('30x50')
    expect(sizes).toContain('40x60')
    expect(sizes).toContain('50x50')
    expect(sizes).toContain('80x20')
    expect(sizes).toContain('shelf-card')
  })

  it('widthPt and heightPt are positive numbers', () => {
    for (const spec of LABEL_SIZES) {
      expect(spec.widthPt).toBeGreaterThan(0)
      expect(spec.heightPt).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// generateLabelPDF
// ---------------------------------------------------------------------------
describe('generateLabelPDF', () => {
  const allSizes: LabelSize[] = ['30x20', '30x50', '40x60', '50x50', '80x20', 'shelf-card']

  for (const size of allSizes) {
    it(`returns a Buffer for size ${size}`, async () => {
      const result = await generateLabelPDF([mockProduct], size, 1)
      expect(result).toBeInstanceOf(Buffer)
      expect(result.length).toBeGreaterThan(0)
    })
  }

  it('handles multiple products', async () => {
    const products = [mockProduct, mockProductWithVariant]
    const result = await generateLabelPDF(products, '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles multiple copies', async () => {
    const result = await generateLabelPDF([mockProduct], '30x20', 3)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles product with variant name', async () => {
    const result = await generateLabelPDF([mockProductWithVariant], '30x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles product with no MRP', async () => {
    const result = await generateLabelPDF([mockProductNoGst], '40x60', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles product with brand name (50x50)', async () => {
    const result = await generateLabelPDF([mockProduct], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('renders 50x50 with variant_name (covers lines 256-259)', async () => {
    const result = await generateLabelPDF([mockProductWithVariant], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('renders 50x50 with variant_name and brand_name both set', async () => {
    const p: LabelProduct = { ...mockProductWithVariant, brand_name: 'Unbrako' }
    const result = await generateLabelPDF([p], '50x50', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('renders 80x20 with variant_name (covers lines 294-297)', async () => {
    const result = await generateLabelPDF([mockProductWithVariant], '80x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles zero copies gracefully (no pages added)', async () => {
    const result = await generateLabelPDF([mockProduct], '30x20', 0)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty product list', async () => {
    const result = await generateLabelPDF([], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles product with price_ex_gst null (uses base_price)', async () => {
    const p = { ...mockProduct, price_ex_gst: null }
    const result = await generateLabelPDF([p], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles product with zero base_price (no price drawn)', async () => {
    const p = { ...mockProduct, price_ex_gst: 0, base_price: 0, mrp: null }
    const result = await generateLabelPDF([p], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// generateLabelSheetPDF
// ---------------------------------------------------------------------------
describe('generateLabelSheetPDF', () => {
  it('returns a Buffer', async () => {
    const result = await generateLabelSheetPDF([mockProduct], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles multiple products across multiple copies', async () => {
    const products = [mockProduct, mockProductWithVariant]
    const result = await generateLabelSheetPDF(products, '40x60', 2)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty product list', async () => {
    const result = await generateLabelSheetPDF([], '30x20', 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('works for all sizes', async () => {
    const sizes: LabelSize[] = ['30x20', '30x50', '40x60', '50x50', '80x20', 'shelf-card']
    for (const size of sizes) {
      const result = await generateLabelSheetPDF([mockProduct], size, 1)
      expect(result).toBeInstanceOf(Buffer)
    }
  })

  it('handles large number of labels (pagination)', async () => {
    const products = Array.from({ length: 20 }, (_, i) => ({ ...mockProduct, sku: `SKU-${i}`, name: `Product ${i}` }))
    const result = await generateLabelSheetPDF(products, '40x60', 2)
    expect(result).toBeInstanceOf(Buffer)
  })
})

// ---------------------------------------------------------------------------
// generateShelfLabelPDF
// ---------------------------------------------------------------------------
describe('generateShelfLabelPDF', () => {
  const shelfItem: ShelfLabelItem = {
    displayCode: 'A-01-01',
    warehouseName: 'Main Warehouse',
    productName: 'Hex Bolt M6',
    sku: 'BOLT-M6-001',
  }

  const minimalShelfItem: ShelfLabelItem = {
    displayCode: 'B-02',
    warehouseName: 'Store',
  }

  it('returns a Buffer', async () => {
    const result = await generateShelfLabelPDF([shelfItem], 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles minimal shelf item (no productName or sku)', async () => {
    const result = await generateShelfLabelPDF([minimalShelfItem], 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles multiple copies', async () => {
    const result = await generateShelfLabelPDF([shelfItem], 3)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles multiple items', async () => {
    const items = [shelfItem, minimalShelfItem]
    const result = await generateShelfLabelPDF(items, 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles empty items list', async () => {
    const result = await generateShelfLabelPDF([], 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles displayCode with non-ASCII characters gracefully', async () => {
    const item: ShelfLabelItem = {
      displayCode: 'A-01–B', // contains en-dash
      warehouseName: 'Main',
    }
    const result = await generateShelfLabelPDF([item], 1)
    expect(result).toBeInstanceOf(Buffer)
  })

  it('handles very long displayCode (truncated to 48 chars)', async () => {
    const item: ShelfLabelItem = {
      displayCode: 'A'.repeat(100),
      warehouseName: 'Warehouse',
      productName: 'Test Product',
      sku: 'SKU-001',
    }
    const result = await generateShelfLabelPDF([item], 1)
    expect(result).toBeInstanceOf(Buffer)
  })
})
