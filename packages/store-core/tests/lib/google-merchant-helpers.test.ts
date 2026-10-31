import { describe, it, expect } from 'vitest'
import {
  getGoogleProductCategory,
  buildProductType,
  buildProductHighlights,
  buildProductDetails,
  buildCustomLabels,
} from '@/lib/shared/google-merchant-helpers'

describe('getGoogleProductCategory', () => {
  it('returns categories.google_product_category when present', () => {
    const product = { categories: { google_product_category: 'Electronics' } }
    expect(getGoogleProductCategory(product)).toBe('Electronics')
  })

  it('falls back to parent_google_product_category', () => {
    const product = { categories: { parent_google_product_category: 'Hardware' } }
    expect(getGoogleProductCategory(product)).toBe('Hardware')
  })

  it('returns empty string when neither is set', () => {
    const product = { categories: {} }
    expect(getGoogleProductCategory(product)).toBe('')
  })

  it('returns empty string when categories is null/undefined', () => {
    expect(getGoogleProductCategory({})).toBe('')
    expect(getGoogleProductCategory({ categories: null })).toBe('')
  })

  it('prefers google_product_category over parent fallback', () => {
    const product = {
      categories: {
        google_product_category: 'Primary',
        parent_google_product_category: 'Parent',
      },
    }
    expect(getGoogleProductCategory(product)).toBe('Primary')
  })
})

describe('buildProductType', () => {
  it('returns parent > child when both present', () => {
    const product = { categories: { parent_name: 'Tools', name: 'Hand Tools' } }
    expect(buildProductType(product)).toBe('Tools > Hand Tools')
  })

  it('returns only category name when no parent', () => {
    const product = { categories: { name: 'Fasteners' } }
    expect(buildProductType(product)).toBe('Fasteners')
  })

  it('returns empty string when no categories', () => {
    expect(buildProductType({})).toBe('')
    expect(buildProductType({ categories: {} })).toBe('')
  })

  it('returns empty string when categories is null', () => {
    expect(buildProductType({ categories: null })).toBe('')
  })
})

describe('buildProductHighlights', () => {
  it('returns empty array for empty product', () => {
    expect(buildProductHighlights({})).toEqual([])
  })

  it('adds material highlight', () => {
    const result = buildProductHighlights({ material: 'Steel' })
    expect(result).toContain('Made of Steel')
  })

  it('adds finish highlight', () => {
    const result = buildProductHighlights({ finish: 'Zinc Plated' })
    expect(result).toContain('Zinc Plated finish')
  })

  it('adds size highlight', () => {
    const result = buildProductHighlights({ size: 'M6x30' })
    expect(result).toContain('Size: M6x30')
  })

  it('adds weight highlight', () => {
    const result = buildProductHighlights({ weight: 0.5 })
    expect(result).toContain('Weight: 0.5 kg')
  })

  it('adds dimensions highlight', () => {
    const result = buildProductHighlights({ dimensions: '10x20x5 mm' })
    expect(result).toContain('Dimensions: 10x20x5 mm')
  })

  it('adds HSN code highlight', () => {
    const result = buildProductHighlights({ hsn_code: '73181500' })
    expect(result).toContain('HSN Code: 73181500')
  })

  it('adds brand highlight', () => {
    const result = buildProductHighlights({ brands: { name: 'Unbrako' } })
    expect(result).toContain('Brand: Unbrako')
  })

  it('caps at 10 highlights', () => {
    const product = {
      material: 'Steel',
      finish: 'Zinc',
      size: 'M6',
      weight: 0.1,
      dimensions: '10mm',
      hsn_code: '7318',
      brands: { name: 'Unbrako' },
    }
    const result = buildProductHighlights(product)
    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('builds all highlights together', () => {
    const product = {
      material: 'Stainless Steel',
      finish: 'Polished',
      size: 'M8',
      weight: 0.2,
      dimensions: '8x20 mm',
      hsn_code: '7318',
      brands: { name: 'TestBrand' },
    }
    const result = buildProductHighlights(product)
    expect(result).toHaveLength(7)
  })
})

describe('buildProductDetails', () => {
  it('returns empty array for empty product', () => {
    expect(buildProductDetails({})).toEqual([])
  })

  it('includes weight detail', () => {
    const result = buildProductDetails({ weight: 1.5 })
    expect(result).toContainEqual({ section: 'Specifications', attribute: 'Weight', value: '1.5 kg' })
  })

  it('includes material detail', () => {
    const result = buildProductDetails({ material: 'Brass' })
    expect(result).toContainEqual({ section: 'Specifications', attribute: 'Material', value: 'Brass' })
  })

  it('includes finish detail', () => {
    const result = buildProductDetails({ finish: 'Chrome' })
    expect(result).toContainEqual({ section: 'Specifications', attribute: 'Finish', value: 'Chrome' })
  })

  it('includes dimensions detail', () => {
    const result = buildProductDetails({ dimensions: '50x30x10' })
    expect(result).toContainEqual({ section: 'Specifications', attribute: 'Dimensions', value: '50x30x10' })
  })

  it('includes size detail', () => {
    const result = buildProductDetails({ size: 'M10' })
    expect(result).toContainEqual({ section: 'Specifications', attribute: 'Size', value: 'M10' })
  })

  it('includes HSN code in Tax section', () => {
    const result = buildProductDetails({ hsn_code: '73181500' })
    expect(result).toContainEqual({ section: 'Tax', attribute: 'HSN Code', value: '73181500' })
  })

  it('builds all details together', () => {
    const product = { weight: 1, material: 'Steel', finish: 'Zinc', dimensions: '10mm', size: 'M6', hsn_code: '7318' }
    const result = buildProductDetails(product)
    expect(result).toHaveLength(6)
  })
})

describe('buildCustomLabels', () => {
  it('returns 5 labels tuple', () => {
    const result = buildCustomLabels({ base_price: 500 })
    expect(result).toHaveLength(5)
  })

  it('label0 is category name', () => {
    const [label0] = buildCustomLabels({ categories: { name: 'Bolts' }, base_price: 100 })
    expect(label0).toBe('Bolts')
  })

  it('label0 is empty when no category', () => {
    const [label0] = buildCustomLabels({ base_price: 100 })
    expect(label0).toBe('')
  })

  it('price bucket: under-100', () => {
    const [, label1] = buildCustomLabels({ base_price: 50 })
    expect(label1).toBe('under-100')
  })

  it('price bucket: 100-500', () => {
    const [, label1] = buildCustomLabels({ base_price: 100 })
    expect(label1).toBe('100-500')
  })

  it('price bucket: 500-2000', () => {
    const [, label1] = buildCustomLabels({ base_price: 500 })
    expect(label1).toBe('500-2000')
  })

  it('price bucket: 2000-10000', () => {
    const [, label1] = buildCustomLabels({ base_price: 2000 })
    expect(label1).toBe('2000-10000')
  })

  it('price bucket: above-10000', () => {
    const [, label1] = buildCustomLabels({ base_price: 10000 })
    expect(label1).toBe('above-10000')
  })

  it('label2 is brand name', () => {
    const [, , label2] = buildCustomLabels({ base_price: 100, brands: { name: 'Bosch' } })
    expect(label2).toBe('Bosch')
  })

  it('label2 defaults to unbranded', () => {
    const [, , label2] = buildCustomLabels({ base_price: 100 })
    expect(label2).toBe('unbranded')
  })

  it('label3 in-stock by default', () => {
    const [, , , label3] = buildCustomLabels({ base_price: 100 })
    expect(label3).toBe('in-stock')
  })

  it('label3 out-of-stock from variantStockStatus', () => {
    const [, , , label3] = buildCustomLabels({ base_price: 100 }, 'Out of Stock')
    expect(label3).toBe('out-of-stock')
  })

  it('label3 low-stock from variantStockStatus', () => {
    const [, , , label3] = buildCustomLabels({ base_price: 100 }, 'Low Stock')
    expect(label3).toBe('low-stock')
  })

  it('label3 uses product stock_status when no variantStockStatus', () => {
    const [, , , label3] = buildCustomLabels({ base_price: 100, stock_status: 'Out of Stock' })
    expect(label3).toBe('out-of-stock')
  })

  it('label4 is featured when is_featured', () => {
    const [, , , , label4] = buildCustomLabels({ base_price: 100, is_featured: true })
    expect(label4).toBe('featured')
  })

  it('label4 is standard when not featured', () => {
    const [, , , , label4] = buildCustomLabels({ base_price: 100, is_featured: false })
    expect(label4).toBe('standard')
  })

  it('handles base_price of 0 as under-100', () => {
    const [, label1] = buildCustomLabels({ base_price: 0 })
    expect(label1).toBe('under-100')
  })

  it('handles null base_price as 0', () => {
    const [, label1] = buildCustomLabels({ base_price: null })
    expect(label1).toBe('under-100')
  })
})
