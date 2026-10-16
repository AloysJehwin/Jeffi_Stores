import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/google-merchant-helpers', () => ({
  getGoogleProductCategory: vi.fn(),
  buildProductType: vi.fn(),
  buildProductHighlights: vi.fn(),
  buildProductDetails: vi.fn(),
  buildCustomLabels: vi.fn(),
}))

import { productToGmcItems, gmcItemProblem } from '@/lib/merchant/mapper'
import { buildVelocity } from '@/lib/merchant/custom-labels'

const BASE = 'https://shop.example.com'
import * as helpers from '@/lib/shared/google-merchant-helpers'

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
    mockBuildProductDetails.mockReturnValue([{ section: 'Specs', attribute: 'Material', value: 'Steel' }])
    mockBuildCustomLabels.mockReturnValue(['label0', 'label1', 'label2', 'label3', 'label4'])
  })

  describe('productToGmcItems - simple product (no variants)', () => {
    it('returns array with single item for simple product', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(Array.isArray(items)).toBe(true)
      expect(items).toHaveLength(1)
    })

    it('excludes digital products from the feed', () => {
      expect(productToGmcItems(makeProduct({ is_digital: true }), BASE)).toEqual([])
    })

    it('sets offerId from sku (sanitized)', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW/001 test' }), BASE)
      expect(items[0].offerId).toBe('TW_001_test')
    })

    it('sets offerId without transformation for clean sku', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW-001' }), BASE)
      expect(items[0].offerId).toBe('TW-001')
    })

    it('sets title from product name', () => {
      const items = productToGmcItems(makeProduct({ name: 'My Widget' }), BASE)
      expect(items[0].productAttributes.title).toBe('My Widget')
    })

    it('sets link with product slug', () => {
      const items = productToGmcItems(makeProduct({ slug: 'my-widget' }), BASE)
      expect(items[0].productAttributes.link).toBe('https://shop.example.com/products/my-widget')
    })

    it('sets sale price when mrp > base_price', () => {
      // price = mrp (the listed price), salePrice = base_price (discounted)
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: 249 }), BASE)
      expect(items[0].productAttributes.price.amountMicros).toBe('249000000')
      expect(items[0].productAttributes.salePrice?.amountMicros).toBe('199000000')
      expect(items[0].productAttributes.salePrice?.currencyCode).toBe('INR')
      expect(items[0].productAttributes.salePrice).toBeDefined()
    })

    it('omits salePrice when mrp equals base_price', () => {
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: 199 }), BASE)
      expect(items[0].productAttributes.salePrice).toBeUndefined()
    })

    it('omits salePrice when no mrp', () => {
      const items = productToGmcItems(makeProduct({ base_price: 199, mrp: null }), BASE)
      expect(items[0].productAttributes.salePrice).toBeUndefined()
    })

    it('omits salePrice when mrp < base_price (invalid)', () => {
      const items = productToGmcItems(makeProduct({ base_price: 300, mrp: 200 }), BASE)
      expect(items[0].productAttributes.salePrice).toBeUndefined()
    })

    it('advertises the selling price, not a lower mrp', () => {
      const items = productToGmcItems(makeProduct({ base_price: 300, mrp: 200 }), BASE)
      expect(items[0].productAttributes.price.amountMicros).toBe('300000000')
    })

    it('caps the title at 150 characters', () => {
      const items = productToGmcItems(makeProduct({ name: 'x'.repeat(200) }), BASE)
      expect(items[0].productAttributes.title.length).toBe(150)
    })

    it('sets availability to in stock for In Stock status', () => {
      const items = productToGmcItems(makeProduct({ stock_status: 'In Stock' }), BASE)
      expect(items[0].productAttributes.availability).toBe('IN_STOCK')
    })

    it('sets availability to out of stock for Out of Stock status', () => {
      const items = productToGmcItems(makeProduct({ stock_status: 'Out of Stock' }), BASE)
      expect(items[0].productAttributes.availability).toBe('OUT_OF_STOCK')
    })

    it('sets brand from brands.name', () => {
      const items = productToGmcItems(makeProduct({ brands: { name: 'TestBrand' } }), BASE)
      expect(items[0].productAttributes.brand).toBe('TestBrand')
    })

    it('sets brand to undefined when no brand', () => {
      const items = productToGmcItems(makeProduct({ brands: null }), BASE)
      expect(items[0].productAttributes.brand).toBeUndefined()
    })

    it('sets description truncated to 5000 chars', () => {
      const longDesc = 'A'.repeat(6000)
      const items = productToGmcItems(makeProduct({ description: longDesc }), BASE)
      expect(items[0].productAttributes.description.length).toBeLessThanOrEqual(5000)
    })

    it('sets condition to new', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.condition).toBe('NEW')
    })

    it('sets ageGroup to adult', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.ageGroup).toBe('ADULT')
    })

    it('builds a Merchant API ProductInput (contentLanguage + feedLabel, no channel)', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].contentLanguage).toBe('en')
      expect(items[0].feedLabel).toBe('IN')
      expect(items[0].channel).toBeUndefined()
      expect(items[0].targetCountry).toBeUndefined()
      expect(items[0].productAttributes.price).toEqual({ amountMicros: '249000000', currencyCode: 'INR' })
    })

    it('sets shipping with free INR', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.shipping).toHaveLength(1)
      expect(items[0].productAttributes.shipping[0].price.amountMicros).toBe('0')
      expect(items[0].productAttributes.shipping[0].price.currencyCode).toBe('INR')
    })

    it('does not set shippingWeight (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct({ weight: 1.5 }), BASE)
      expect(items[0].productAttributes.shippingWeight).toBeUndefined()
    })

    it('omits shippingWeight when no weight', () => {
      const items = productToGmcItems(makeProduct({ weight: null }), BASE)
      expect(items[0].productAttributes.shippingWeight).toBeUndefined()
    })

    it('does not set googleProductCategory (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.googleProductCategory).toBeUndefined()
    })

    it('does not set productTypes (not in mapper output)', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.productTypes).toBeUndefined()
    })

    it('sets productHighlights from helper', () => {
      // Content API v2.1: productHighlights is an array of plain strings.
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.productHighlights).toEqual(['Durable', 'Lightweight'])
    })

    it('sets productDetails from helper', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.productDetails).toHaveLength(1)
      expect(items[0].productAttributes.productDetails[0].sectionName).toBe('Specs')
    })

    it('omits productHighlights when empty', () => {
      mockBuildProductHighlights.mockReturnValueOnce([])
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.productHighlights).toBeUndefined()
    })

    it('omits productDetails when empty', () => {
      mockBuildProductDetails.mockReturnValueOnce([])
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.productDetails).toBeUndefined()
    })

    it('sets the bidding labels: margin band (0) and stock state (2), not the helper labels', () => {
      const items = productToGmcItems(makeProduct({ price_ex_gst: 200, cost_price: 100, inventory_quantity: 4 }), BASE)
      expect(items[0].productAttributes.customLabel0).toBe('margin-high')
      expect(items[0].productAttributes.customLabel2).toBe('in-stock')
      expect(items[0].productAttributes.customLabel3).toBeUndefined()
      expect(items[0].productAttributes.customLabel4).toBeUndefined()
      expect(mockBuildCustomLabels).not.toHaveBeenCalled()
    })

    it('marks an unknown margin when there is no cost price', () => {
      expect(productToGmcItems(makeProduct({ cost_price: null }), BASE)[0].productAttributes.customLabel0).toBe('margin-unknown')
      expect(productToGmcItems(makeProduct({ base_price: 100, price_ex_gst: null, cost_price: 120 }), BASE)[0].productAttributes.customLabel0).toBe(
        'margin-negative'
      )
    })

    it('sets the sales label (1) only when recent sales are passed in', () => {
      expect(productToGmcItems(makeProduct(), BASE)[0].productAttributes.customLabel1).toBeUndefined()
      const velocity = buildVelocity([
        { sku: 'tw-001', units: 9 },
        { sku: 'other', units: 1 },
      ])
      expect(productToGmcItems(makeProduct(), BASE, { velocity })[0].productAttributes.customLabel1).toBe('bestseller')
      expect(productToGmcItems(makeProduct({ sku: 'TW-404', created_at: '2020-01-01' }), BASE, { velocity })[0].productAttributes.customLabel1).toBe(
        'slow-mover'
      )
    })

    it('labels an inactive product out of stock, like its availability', () => {
      const [item] = productToGmcItems(makeProduct({ is_active: false, stock_status: 'In Stock' }), BASE)
      expect(item.productAttributes.availability).toBe('OUT_OF_STOCK')
      expect(item.productAttributes.customLabel2).toBe('out-of-stock')
    })

    it('sets primary image link', () => {
      const product = makeProduct({
        product_images: [
          { id: 'img1', image_url: 'https://cdn.example.com/img1.jpg', is_primary: true },
          { id: 'img2', image_url: 'https://cdn.example.com/img2.jpg', is_primary: false },
        ],
      })
      const items = productToGmcItems(product, BASE)
      expect(items[0].productAttributes.imageLink).toBe('https://cdn.example.com/img1.jpg')
    })

    it('uses first image when no primary flagged', () => {
      const product = makeProduct({
        product_images: [{ id: 'img1', image_url: 'https://cdn.example.com/first.jpg', is_primary: false }],
      })
      const items = productToGmcItems(product, BASE)
      expect(items[0].productAttributes.imageLink).toBe('https://cdn.example.com/first.jpg')
    })

    it('sets additionalImageLinks excluding primary', () => {
      const product = makeProduct({
        product_images: [
          { id: 'img1', image_url: 'https://cdn.example.com/img1.jpg', is_primary: true },
          { id: 'img2', image_url: 'https://cdn.example.com/img2.jpg', is_primary: false },
          { id: 'img3', image_url: 'https://cdn.example.com/img3.jpg', is_primary: false },
        ],
      })
      const items = productToGmcItems(product, BASE)
      expect(items[0].productAttributes.additionalImageLinks).toHaveLength(2)
      expect(items[0].productAttributes.additionalImageLinks).not.toContain('https://cdn.example.com/img1.jpg')
    })

    it('sets isBundle to false', () => {
      const items = productToGmcItems(makeProduct(), BASE)
      expect(items[0].productAttributes.isBundle).toBe(false)
    })

    it('does not send the HSN code as taxCategory', () => {
      const items = productToGmcItems(makeProduct({ hsn_code: '8204' }), BASE)
      expect(items[0].productAttributes.taxCategory).toBeUndefined()
    })

    it('sets identifierExists false for an mpn without a brand', () => {
      const items = productToGmcItems(makeProduct({ mpn: 'MPN-123', brands: { name: '' } }), BASE)
      expect(items[0].productAttributes.identifierExists).toBe(false)
    })

    it('sets identifierExists true when mpn present with a brand', () => {
      const items = productToGmcItems(makeProduct({ mpn: 'MPN-123' }), BASE)
      expect(items[0].productAttributes.identifierExists).toBe(true)
    })

    it('sets identifierExists true when gtin present', () => {
      const items = productToGmcItems(makeProduct({ gtin: '0123456789012' }), BASE)
      expect(items[0].productAttributes.identifierExists).toBe(true)
    })

    it('sets identifierExists false when only a brand is present', () => {
      const items = productToGmcItems(makeProduct({ brands: { name: 'Acme' } }), BASE)
      expect(items[0].productAttributes.identifierExists).toBe(false)
    })

    it('sets identifierExists false when no identifiers', () => {
      const items = productToGmcItems(
        makeProduct({
          gtin: null,
          mpn: null,
          brands: { name: '' },
        }), BASE)
      expect(items[0].productAttributes.identifierExists).toBe(false)
    })
  })

  describe('productToGmcItems - product with variants', () => {
    function makeVariantProduct(variantOverrides: any[] = []) {
      return makeProduct({
        has_variants: true,
        product_variants:
          variantOverrides.length > 0
            ? variantOverrides
            : [
                { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
                { sku: 'TW-001-L', variant_name: 'Large', price: 249, mrp: 299, stock_status: 'Out of Stock' },
              ],
      })
    }

    it('returns one item per variant', () => {
      const items = productToGmcItems(makeVariantProduct(), BASE)
      expect(items).toHaveLength(2)
    })

    it('filters out variants with null price', () => {
      const items = productToGmcItems(
        makeVariantProduct([
          { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' },
          { sku: 'TW-001-NP', variant_name: 'No Price', price: null, mrp: null, stock_status: 'In Stock' },
        ]), BASE)
      expect(items).toHaveLength(1)
    })

    it('sets title as product name + variant name', () => {
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' }]), BASE)
      expect(items[0].productAttributes.title).toBe('Test Widget - Small')
    })

    it('sets link with sku query param', () => {
      const items = productToGmcItems(
        makeVariantProduct([
          { sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: null, stock_status: 'In Stock' },
        ]), BASE)
      expect(items[0].productAttributes.link).toContain('?sku=')
    })

    it('sets itemGroupId from product sku', () => {
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'TW-001-S', variant_name: 'Small', price: 199, mrp: 249, stock_status: 'In Stock' }]), BASE)
      expect(items[0].productAttributes.itemGroupId).toBe('TW-001')
    })

    it('sets sale price when variant mrp > variant price', () => {
      // Mapper: price field = mrp (listed), salePrice = actual price (discounted)
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'VAR-1', variant_name: 'Size M', price: 199, mrp: 249, stock_status: 'In Stock' }]), BASE)
      expect(items[0].productAttributes.price.amountMicros).toBe('249000000')
      expect(items[0].productAttributes.salePrice?.amountMicros).toBe('199000000')
      expect(items[0].productAttributes.salePrice).toBeDefined()
    })

    it('falls back to product mrp when variant has no mrp', () => {
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'VAR-1', variant_name: 'Size M', price: 199, mrp: null, stock_status: 'In Stock' }]), BASE)
      // product.mrp = 249 > 199 so hasSale is true; price = mrp (249), salePrice = price (199)
      expect(items[0].productAttributes.price.amountMicros).toBe('249000000')
      expect(items[0].productAttributes.salePrice?.amountMicros).toBe('199000000')
      expect(items[0].productAttributes.salePrice).toBeDefined()
    })

    it('uses the variant selling price when the mrp is lower (ex-GST mrp)', () => {
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'VAR-1', variant_name: 'M', price: 127.16, mrp: 107.76, stock_status: 'In Stock' }]), BASE)
      expect(items[0].productAttributes.price.amountMicros).toBe('127160000')
      expect(items[0].productAttributes.salePrice).toBeUndefined()
    })

    it('sets size from variant_name', () => {
      const items = productToGmcItems(
        makeVariantProduct([{ sku: 'VAR-1', variant_name: 'XL', price: 199, mrp: 249, stock_status: 'In Stock' }]), BASE)
      expect(items[0].productAttributes.size).toBe('XL')
    })

    it('sets availability per variant stock_status', () => {
      const items = productToGmcItems(
        makeVariantProduct([
          { sku: 'VAR-IN', variant_name: 'A', price: 100, mrp: 120, stock_status: 'In Stock' },
          { sku: 'VAR-OUT', variant_name: 'B', price: 100, mrp: 120, stock_status: 'Out of Stock' },
        ]), BASE)
      expect(items[0].productAttributes.availability).toBe('IN_STOCK')
      expect(items[1].productAttributes.availability).toBe('OUT_OF_STOCK')
    })

    it('labels each variant from its own price, cost, stock and sales', () => {
      const velocity = buildVelocity([{ sku: 'VAR-B', units: 5 }])
      const items = productToGmcItems(
        makeProduct({
          has_variants: true,
          cost_price: 10,
          product_variants: [
            { sku: 'VAR-A', variant_name: 'A', price: 118, price_ex_gst: 100, cost_price: 90, stock_status: 'Low Stock' },
            { sku: 'VAR-B', variant_name: 'B', price: 118, price_ex_gst: 100, cost_price: 0, stock_status: 'Out of Stock' },
          ],
        }),
        BASE,
        { velocity }
      )
      expect(items.map(i => i.productAttributes.customLabel0)).toEqual(['margin-low', 'margin-high'])
      expect(items.map(i => i.productAttributes.customLabel1)).toEqual(['slow-mover', 'bestseller'])
      expect(items.map(i => i.productAttributes.customLabel2)).toEqual(['low-stock', 'out-of-stock'])
    })

    it('prefers variant gtin over product gtin', () => {
      const product = makeProduct({
        has_variants: true,
        gtin: 'product-gtin',
        product_variants: [
          { sku: 'V1', variant_name: 'A', price: 100, mrp: 120, stock_status: 'In Stock', gtin: 'variant-gtin' },
        ],
      })
      const items = productToGmcItems(product, BASE)
      expect(items[0].productAttributes.gtins).toEqual(['variant-gtin'])
    })
  })

  describe('buildOfferId', () => {
    it('replaces spaces with underscore in sku', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW 001' }), BASE)
      expect(items[0].offerId).toBe('TW_001')
    })

    it('keeps alphanumeric, underscore, colon, dot, hyphen', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW-001:v2.0_test' }), BASE)
      expect(items[0].offerId).toBe('TW-001:v2.0_test')
    })

    it('replaces special chars with underscore', () => {
      const items = productToGmcItems(makeProduct({ sku: 'TW#001@store' }), BASE)
      expect(items[0].offerId).toBe('TW_001_store')
    })
  })

  describe('gmcItemProblem', () => {
    const attrs = { title: 'T', imageLink: 'https://cdn/x.png', price: { amountMicros: '10000000', currencyCode: 'INR' } }
    const item = (patch: Record<string, unknown> = {}, offerId = 'A') => ({
      offerId,
      productAttributes: { ...attrs, ...patch },
    })

    it('accepts a complete item', () => {
      expect(gmcItemProblem(item())).toBeNull()
    })

    it.each([
      [{ title: '' }, 'Missing product name'],
      [{ imageLink: '' }, 'Missing product image'],
      [{ imageLink: '/uploads/x.png' }, 'Product image is not a full http(s) URL'],
      [{ price: { amountMicros: '0', currencyCode: 'INR' } }, 'Missing or zero price'],
      [{ price: { amountMicros: 'NaN', currencyCode: 'INR' } }, 'Missing or zero price'],
    ])('flags %o', (patch, reason) => {
      expect(gmcItemProblem(item(patch))).toBe(reason)
    })

    it('flags an offer id longer than 50 characters', () => {
      expect(gmcItemProblem(item({}, 'x'.repeat(51)))).toBe('SKU is longer than 50 characters')
    })
  })
})
