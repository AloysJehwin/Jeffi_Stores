import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/google-merchant-helpers', () => ({
  getGoogleProductCategory: vi.fn(),
  buildProductType: vi.fn(),
  buildProductHighlights: vi.fn(),
  buildProductDetails: vi.fn(),
  buildCustomLabels: vi.fn(),
}))

import { productToGmcItems } from '@/lib/merchant/mapper'
import * as helpers from '@/lib/google-merchant-helpers'

const mockGetGoogleProductCategory = vi.mocked(helpers.getGoogleProductCategory)
const mockBuildProductType = vi.mocked(helpers.buildProductType)
const mockBuildProductHighlights = vi.mocked(helpers.buildProductHighlights)
const mockBuildProductDetails = vi.mocked(helpers.buildProductDetails)
const mockBuildCustomLabels = vi.mocked(helpers.buildCustomLabels)

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    name: 'Test Widget',
    sku: 'TW-001',
    slug: 'test-widget',
    description: 'A great widget',
    base_price: 199,
    mrp: 249,
    stock_status: 'In Stock',
    has_variants: false,
    product_variants: [],
    product_images: [],
    brands: { name: 'Acme' },
    categories: { name: 'Tools', slug: 'tools' },
    gtin: null,
    mpn: null,
    material: null,
    weight: null,
    hsn_code: null,
    size: null,
    ...overrides,
  }
}

describe('merchant/mapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGoogleProductCategory.mockReturnValue('Hardware > Tools')
    mockBuildProductType.mockReturnValue('Tools > Hand Tools')
    mockBuildProductHighlights.mockReturnValue(['Durable', 'Lightweight'])
    mockBuildProductDetails.mockReturnValue([
      { section: 'Specs', attribute: 'Material', value: 'Steel' },
    ])
    mockBuildCustomLabels.mockReturnValue(['label0', 'label1', 'label2', 'label3', 'label4'])
  })

  describe('productToGmcItems - simple product (no variants)', () => {
    it('returns array with single item for simple product', () => {
      const items = productToGmcItems(makeProduct())
      expect(Array.isArray(items)).toBe(true)
      expect(items).toHaveLength(1)
    })

    it('sets offerId from sku (sanitized)', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW/001 test' }))
      expect(items[0].offerId).toBe('TW_001_test')
    })

    it('sets offerId without transformation for clean sku', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW-001' }))
      expect(items[0].offerId).toBe('TW-001')
    })

    it('sets title from product name', () => {
      const items = productToGmcItems(makeProduct({ name: 'My Widget' }))
      expect(items[0].title).toBe('My Widget')
    })

    it('sets link with product slug', () => {
      const items = productToGmcItems(makeProduct({ slug: 'my-widget' }))
      expect(items[0].link).toContain('/products/my-widget')
    })

    it('sets sale price when mrp > base_price', () => {
      // Mapper: price.value = mrp (the listed price), salePrice.value = base_price (discounted)
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: 249 }))
      expect(items[0].price.value).toBe('249.00')
      expect(items[0].salePrice?.value).toBe('199.00')
      expect(items[0].salePrice?.currency).toBe('INR')
      expect(items[0].salePrice).toBeDefined()
    })

    it('omits salePrice when mrp equals base_price', () => {
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: 199 }))
      expect(items[0].salePrice).toBeUndefined()
    })

    it('omits salePrice when no mrp', () => {
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: null }))
      expect(items[0].salePrice).toBeUndefined()
    })

    it('omits salePrice when mrp < base_price (invalid)', () => {
      const items = productToGmcItems(makeProduct({ base_price: 300, mrp: 200 }))
      expect(items[0].salePrice).toBeUndefined()
    })

    it('sets availability to in stock for In Stock status', () => {
      const items = productToGmcItems(makeProduct({ stock_status: 'In Stock' }))
      expect(items[0].availability).toBe('in stock')
    })

    it('sets availability to out of stock for Out of Stock status', () => {
      const items = productToGmcItems(makeProduct({ stock_status: 'Out of Stock' }))
      expect(items[0].availability).toBe('out of stock')
    })

    it('sets brand from brands.name', () => {
      const items = productToGmcItems(makeProduct({ brands: { name: 'TestBrand' } }))
      expect(items[0].brand).toBe('TestBrand')
    })

    it('sets brand to undefined when no brand', () => {
      const items = productToGmcItems(makeProduct({ brands: null }))
      expect(items[0].brand).toBeUndefined()
    })

    it('sets description truncated to 5000 chars', () => {
      const longDesc = 'A'.repeat(6000)
      const items = productToGmcItems(makeProduct({ description: longDesc }))
      expect(items[0].description.length).toBeLessThanOrEqual(5000)
    })

    it('sets condition to new', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].condition).toBe('new')
    })

    it('sets ageGroup to adult', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].ageGroup).toBe('adult')
    })

    it('sets channel, contentLanguage, targetCountry', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].channel).toBe('online')
      expect(items[0].contentLanguage).toBe('en')
      expect(items[0].targetCountry).toBe('IN')
    })

    it('sets shipping with free INR', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].shipping).toHaveLength(1)
      expect(items[0].shipping[0].price.value).toBe('0')
      expect(items[0].shipping[0].price.currency).toBe('INR')
    })

    it('does not set shippingWeight (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct({ weight: 1.5 }))
      expect(items[0].shippingWeight).toBeUndefined()
    })

    it('omits shippingWeight when no weight', () => {
      const items = productToGmcItems(makeProduct({ weight: null }))
      expect(items[0].shippingWeight).toBeUndefined()
    })

    it('does not set googleProductCategory (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].googleProductCategory).toBeUndefined()
    })

    it('does not set productTypes (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].productTypes).toBeUndefined()
    })

    it('sets productHighlights from helper', () => {
      // Content API v2.1: productHighlights is an array of plain strings.
      const items = productToGmcItems(makeProduct())
      expect(items[0].productHighlights).toEqual(['Durable', 'Lightweight'])
    })

    it('sets productDetails from helper', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].productDetails).toHaveLength(1)
      expect(items[0].productDetails[0].sectionName).toBe('Specs')
    })

    it('omits productHighlights when empty', () => {
      mockBuildProductHighlights.mockReturnValueOnce([])
      const items = productToGmcItems(makeProduct())
      expect(items[0].productHighlights).toBeUndefined()
    })

    it('omits productDetails when empty', () => {
      mockBuildProductDetails.mockReturnValueOnce([])
      const items = productToGmcItems(makeProduct())
      expect(items[0].productDetails).toBeUndefined()
    })

    it('does not set customLabels (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].customLabel0).toBeUndefined()
      expect(items[0].customLabel4).toBeUndefined()
    })

    it('sets primary image link', () => {
      const product = makeProduct({
        product_images: [
          { id: 'img1', image_url: 'https://cdn.example.com/img1.jpg', is_primary: true },
          { id: 'img2', image_url: 'https://cdn.example.com/img2.jpg', is_primary: false },
        ],
      })
      const items = productToGmcItems(product)
      expect(items[0].imageLink).toBe('https://cdn.example.com/img1.jpg')
    })

    it('uses first image when no primary flagged', () => {
      const product = makeProduct({
        product_images: [
          { id: 'img1', image_url: 'https://cdn.example.com/first.jpg', is_primary: false },
        ],
      })
      const items = productToGmcItems(product)
      expect(items[0].imageLink).toBe('https://cdn.example.com/first.jpg')
    })

    it('sets additionalImageLinks excluding primary', () => {
      const product = makeProduct({
        product_images: [
          { id: 'img1', image_url: 'https://cdn.example.com/img1.jpg', is_primary: true },
          { id: 'img2', image_url: 'https://cdn.example.com/img2.jpg', is_primary: false },
          { id: 'img3', image_url: 'https://cdn.example.com/img3.jpg', is_primary: false },
        ],
      })
      const items = productToGmcItems(product)
      expect(items[0].additionalImageLinks).toHaveLength(2)
      expect(items[0].additionalImageLinks).not.toContain('https://cdn.example.com/img1.jpg')
    })

    it('sets isBundle to false', () => {
      const items = productToGmcItems(makeProduct())
      expect(items[0].isBundle).toBe(false)
    })

    it('sets taxCategory from hsn_code', () => {
      const items = productToGmcItems(makeProduct({ hsn_code: '8204' }))
      expect(items[0].taxCategory).toBe('8204')
    })

    it('sets identifierExists true when mpn present', () => {
      const items = productToGmcItems(makeProduct({ mpn: 'MPN-123' }))
      expect(items[0].identifierExists).toBe(true)
    })

    it('sets identifierExists true when gtin present', () => {
      const items = productToGmcItems(makeProduct({ gtin: '0123456789012' }))
      expect(items[0].identifierExists).toBe(true)
    })

    it('sets identifierExists true when brand present', () => {
      const items = productToGmcItems(makeProduct({ brands: { name: 'Acme' } }))
      expect(items[0].identifierExists).toBe(true)
    })

    it('sets identifierExists false when no identifiers', () => {
      const items = productToGmcItems(makeProduct({
        gtin: null, mpn: null, brands: { name: '' }
      }))
      expect(items[0].identifierExists).toBe(false)
    })
  })

  describe('productToGmcItems - product with variants', () => {
    function makeVariantProduct(variantOverrides: any[] = []) {
      return makeProduct({
        has_variants: true,
        product_variants: variantOverrides.length > 0 ? variantOverrides : [
          { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
          { sku: 'TW-001-L', variant_name: 'Large', price: 249, mrp: 299, stock_status: 'Out of Stock' },
        ],
      })
    }

    it('returns one item per variant', () => {
      const items = productToGmcItems(makeVariantProduct())
      expect(items).toHaveLength(2)
    })

    it('filters out variants with null price', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
        { sku: 'TW-001-NP', variant_name: 'No Price', price: null, mrp: null, stock_status: 'In Stock' },
      ]))
      expect(items).toHaveLength(1)
    })

    it('sets title as product name + variant name', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
      ]))
      expect(items[0].title).toBe('Test Widget - Small')
    })

    it('sets link with sku query param', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: null, stock_status: 'In Stock' },
      ]))
      expect(items[0].link).toContain('?sku=')
    })

    it('sets itemGroupId from product sku', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
      ]))
      expect(items[0].itemGroupId).toBe('TW-001')
    })

    it('sets sale price when variant mrp > variant price', () => {
      // Mapper: price field = mrp (listed), salePrice = actual price (discounted)
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'VAR-1', variant_name: 'Size M', price: 199, mrp: 249, stock_status: 'In Stock' },
      ]))
      expect(items[0].price.value).toBe('249.00')
      expect(items[0].salePrice?.value).toBe('199.00')
      expect(items[0].salePrice).toBeDefined()
    })

    it('falls back to product mrp when variant has no mrp', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'VAR-1', variant_name: 'Size M', price: 199, mrp: null, stock_status: 'In Stock' },
      ]))
      // product.mrp = 249 > 199 so hasSale is true; price = mrp (249), salePrice = price (199)
      expect(items[0].price.value).toBe('249.00')
      expect(items[0].salePrice?.value).toBe('199.00')
      expect(items[0].salePrice).toBeDefined()
    })

    it('sets sizes from variant_name', () => {
      // Content API v2.1: sizes is an array of strings.
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'VAR-1', variant_name: 'XL', price: 199, mrp: 249, stock_status: 'In Stock' },
      ]))
      expect(items[0].sizes).toEqual(['XL'])
    })

    it('sets availability per variant stock_status', () => {
      const items = productToGmcItems(makeVariantProduct([
        { sku: 'VAR-IN', variant_name: 'A', price: 100, mrp: 120, stock_status: 'In Stock' },
        { sku: 'VAR-OUT', variant_name: 'B', price: 100, mrp: 120, stock_status: 'Out of Stock' },
      ]))
      expect(items[0].availability).toBe('in stock')
      expect(items[1].availability).toBe('out of stock')
    })

    it('prefers variant gtin over product gtin', () => {
      const product = makeProduct({
        has_variants: true,
        gtin: 'product-gtin',
        product_variants: [
          { sku: 'V1', variant_name: 'A', price: 100, mrp: 120, stock_status: 'In Stock', gtin: 'variant-gtin' },
        ],
      })
      const items = productToGmcItems(product)
      expect(items[0].gtin).toBe('variant-gtin')
    })
  })

  describe('buildOfferId', () => {
    it('replaces spaces with underscore in sku', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW 001' }))
      expect(items[0].offerId).toBe('TW_001')
    })

    it('keeps alphanumeric, underscore, colon, dot, hyphen', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW-001:v2.0_test' }))
      expect(items[0].offerId).toBe('TW-001:v2.0_test')
    })

    it('replaces special chars with underscore', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW#001@store' }))
      expect(items[0].offerId).toBe('TW_001_store')
    })
  })
})
