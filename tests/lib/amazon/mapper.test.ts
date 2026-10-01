import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/google-merchant-helpers', () => ({
  buildProductHighlights: vi.fn(),
}))

import { productToAmazonListings, productToAmazonOfferListing, productLink } from '@/lib/amazon/mapper'
import * as helpers from '@/lib/shared/google-merchant-helpers'

const mockBuildProductHighlights = vi.mocked(helpers.buildProductHighlights)

// marketplaceId is now an explicit param (was previously the client.MARKETPLACE_ID export).
const MP = 'A21TJRUUN4KGV'

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    name: 'Hex Bolt M12',
    sku: 'HB-M12',
    slug: 'hex-bolt-m12',
    description: 'A strong hex bolt',
    base_price: 100,
    mrp: 120,
    stock_status: 'In Stock',
    has_variants: false,
    product_variants: [],
    product_images: [],
    brands: { name: 'Acme' },
    categories: { name: 'Bolts', parent_name: 'Fasteners' },
    gtin: null,
    mpn: null,
    material: null,
    color: null,
    weight: null,
    dimensions: null,
    size: null,
    hsn_code: null,
    country_of_origin: null,
    is_active: true,
    ...overrides,
  }
}

describe('amazon/mapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildProductHighlights.mockReturnValue(['Durable', 'Lightweight'])
  })

  describe('resolveProductType (via productToAmazonListings)', () => {
    it('maps known category name to product type (BOLTS)', () => {
      const listings = productToAmazonListings(makeProduct({ categories: { name: 'bolts' } }), MP)
      expect(listings[0].productType).toBe('BOLTS')
    })

    it('matches parent_name when name is not a known category', () => {
      const listings = productToAmazonListings(
        makeProduct({ categories: { name: 'unknown-thing', parent_name: 'screws' } }),
        MP
      )
      expect(listings[0].productType).toBe('SCREWS')
    })

    it('falls back to HARDWARE_HANDLE for unknown categories', () => {
      const listings = productToAmazonListings(
        makeProduct({ categories: { name: 'zzz-unknown', parent_name: 'yyy' } }),
        MP
      )
      expect(listings[0].productType).toBe('HARDWARE_HANDLE')
    })

    it('falls back to HARDWARE_HANDLE when no categories', () => {
      const listings = productToAmazonListings(makeProduct({ categories: null }), MP)
      expect(listings[0].productType).toBe('HARDWARE_HANDLE')
    })
  })

  describe('productToAmazonListings - simple product', () => {
    it('returns a single listing', () => {
      const listings = productToAmazonListings(makeProduct(), MP)
      expect(Array.isArray(listings)).toBe(true)
      expect(listings).toHaveLength(1)
    })

    it('sets sku, requirements LISTING', () => {
      const listings = productToAmazonListings(makeProduct({ sku: 'HB-M12' }), MP)
      expect(listings[0].sku).toBe('HB-M12')
      expect(listings[0].requirements).toBe('LISTING')
    })

    it('sets item_name from product name', () => {
      const listings = productToAmazonListings(makeProduct({ name: 'My Bolt' }), MP)
      expect((listings[0].attributes.item_name as any)[0].value).toBe('My Bolt')
    })

    it('includes purchasable_offer and fulfillment_availability', () => {
      const listings = productToAmazonListings(makeProduct(), MP)
      expect(listings[0].attributes.purchasable_offer).toBeDefined()
      expect(listings[0].attributes.fulfillment_availability).toBeDefined()
    })

    it('sets size attribute when product.size present', () => {
      const listings = productToAmazonListings(makeProduct({ size: 'M12' }), MP)
      expect((listings[0].attributes.size as any)[0].value).toBe('M12')
    })

    it('omits size attribute when product.size absent', () => {
      const listings = productToAmazonListings(makeProduct({ size: null }), MP)
      expect(listings[0].attributes.size).toBeUndefined()
    })

    it('sets fulfillment quantity 0 when out of stock', () => {
      const listings = productToAmazonListings(makeProduct({ stock_status: 'Out of Stock' }), MP)
      expect((listings[0].attributes.fulfillment_availability as any)[0].quantity).toBe(0)
    })

    it('sets fulfillment quantity 0 when product inactive', () => {
      const listings = productToAmazonListings(makeProduct({ is_active: false }), MP)
      expect((listings[0].attributes.fulfillment_availability as any)[0].quantity).toBe(0)
    })

    it('sets fulfillment quantity 10 when in stock and active', () => {
      const listings = productToAmazonListings(makeProduct({ stock_status: 'In Stock', is_active: true }), MP)
      expect((listings[0].attributes.fulfillment_availability as any)[0].quantity).toBe(10)
    })

    it('treats undefined is_active as active (in stock)', () => {
      const listings = productToAmazonListings(makeProduct({ is_active: undefined }), MP)
      expect((listings[0].attributes.fulfillment_availability as any)[0].quantity).toBe(10)
    })
  })

  describe('purchasable offer branches', () => {
    it('applies sale price when mrp > base_price', () => {
      const listings = productToAmazonListings(makeProduct({ base_price: 100, mrp: 120 }), MP)
      const offer = (listings[0].attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(100)
      expect(offer.maximum_retail_price[0].schedule[0].value_with_tax).toBe(120)
    })

    it('no sale when mrp is null (listPrice = base_price)', () => {
      const listings = productToAmazonListings(makeProduct({ base_price: 100, mrp: null }), MP)
      const offer = (listings[0].attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(100)
    })

    it('no sale when mrp equals base_price', () => {
      const listings = productToAmazonListings(makeProduct({ base_price: 100, mrp: 100 }), MP)
      const offer = (listings[0].attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(100)
      expect(offer.maximum_retail_price[0].schedule[0].value_with_tax).toBe(100)
    })
  })

  describe('product identity cluster', () => {
    it('uses upc when gtin is 12 digits', () => {
      const listings = productToAmazonListings(makeProduct({ gtin: '012345678905' }), MP)
      const id = (listings[0].attributes.externally_assigned_product_identifier as any)[0]
      expect(id.type).toBe('upc')
      expect(id.value).toBe('012345678905')
    })

    it('uses ean when gtin is 13 digits', () => {
      const listings = productToAmazonListings(makeProduct({ gtin: '0123456789012' }), MP)
      const id = (listings[0].attributes.externally_assigned_product_identifier as any)[0]
      expect(id.type).toBe('ean')
    })

    it('sets exemption flag when no gtin', () => {
      const listings = productToAmazonListings(makeProduct({ gtin: null }), MP)
      expect(listings[0].attributes.supplier_declared_has_product_identifier_exemption).toBeDefined()
    })
  })

  describe('model number', () => {
    it('uses mpn as model number', () => {
      const listings = productToAmazonListings(makeProduct({ mpn: 'MPN-99' }), MP)
      expect((listings[0].attributes.model_number as any)[0].value).toBe('MPN-99')
    })

    it('falls back to sku when no mpn', () => {
      const listings = productToAmazonListings(makeProduct({ mpn: null, sku: 'SKU-1' }), MP)
      expect((listings[0].attributes.model_number as any)[0].value).toBe('SKU-1')
    })

    it('omits model_number when no mpn and no sku', () => {
      const listings = productToAmazonListings(makeProduct({ mpn: null, sku: '' }), MP)
      expect(listings[0].attributes.model_number).toBeUndefined()
    })
  })

  describe('common attributes: color, material, brand, hsn, bullets', () => {
    it('sets color when present', () => {
      const listings = productToAmazonListings(makeProduct({ color: 'Silver' }), MP)
      expect((listings[0].attributes.color as any)[0].value).toBe('Silver')
    })

    it('omits color when absent', () => {
      const listings = productToAmazonListings(makeProduct({ color: null }), MP)
      expect(listings[0].attributes.color).toBeUndefined()
    })

    it('sets brand and manufacturer when brand present', () => {
      const listings = productToAmazonListings(makeProduct({ brands: { name: 'Bosch' } }), MP)
      expect((listings[0].attributes.brand as any)[0].value).toBe('Bosch')
      expect((listings[0].attributes.manufacturer as any)[0].value).toBe('Bosch')
    })

    it('omits brand/manufacturer when no brand', () => {
      const listings = productToAmazonListings(makeProduct({ brands: null }), MP)
      expect(listings[0].attributes.brand).toBeUndefined()
      expect(listings[0].attributes.manufacturer).toBeUndefined()
    })

    it('sets material when present', () => {
      const listings = productToAmazonListings(makeProduct({ material: 'Steel' }), MP)
      expect((listings[0].attributes.material as any)[0].value).toBe('Steel')
    })

    it('sets external_product_information when hsn_code >= 4 digits', () => {
      const listings = productToAmazonListings(makeProduct({ hsn_code: '73181500' }), MP)
      const epi = (listings[0].attributes.external_product_information as any)[0]
      expect(epi.entity).toBe('HSN')
      expect(epi.value).toBe('73181500')
    })

    it('omits external_product_information when hsn too short', () => {
      const listings = productToAmazonListings(makeProduct({ hsn_code: '73' }), MP)
      expect(listings[0].attributes.external_product_information).toBeUndefined()
    })

    it('sets bullet_point from highlights', () => {
      mockBuildProductHighlights.mockReturnValue(['A', 'B', 'C'])
      const listings = productToAmazonListings(makeProduct(), MP)
      expect(listings[0].attributes.bullet_point as any).toHaveLength(3)
    })

    it('omits bullet_point when highlights empty', () => {
      mockBuildProductHighlights.mockReturnValue([])
      const listings = productToAmazonListings(makeProduct(), MP)
      expect(listings[0].attributes.bullet_point).toBeUndefined()
    })

    it('uses product name as description when description missing', () => {
      const listings = productToAmazonListings(makeProduct({ description: null, name: 'Named Fallback' }), MP)
      expect((listings[0].attributes.product_description as any)[0].value).toBe('Named Fallback')
    })

    it('uses country_of_origin default IN', () => {
      const listings = productToAmazonListings(makeProduct({ country_of_origin: null }), MP)
      expect((listings[0].attributes.country_of_origin as any)[0].value).toBe('IN')
    })

    it('uses provided country_of_origin', () => {
      const listings = productToAmazonListings(makeProduct({ country_of_origin: 'CN' }), MP)
      expect((listings[0].attributes.country_of_origin as any)[0].value).toBe('CN')
    })
  })

  describe('item weight and dims', () => {
    it('uses product weight when > 0', () => {
      const listings = productToAmazonListings(makeProduct({ weight: 2 }), MP)
      expect((listings[0].attributes.item_weight as any)[0].value).toBe(2)
    })

    it('uses default weight 0.05 when weight missing/zero', () => {
      const listings = productToAmazonListings(makeProduct({ weight: 0 }), MP)
      expect((listings[0].attributes.item_weight as any)[0].value).toBe(0.05)
    })

    it('parses dimensions into length x width', () => {
      const listings = productToAmazonListings(makeProduct({ dimensions: '30 x 15 mm' }), MP)
      const lw = (listings[0].attributes.item_length_width as any)[0]
      expect(lw.length.value).toBe(30)
      expect(lw.width.value).toBe(15)
    })

    it('uses size for dims when dimensions absent', () => {
      const listings = productToAmazonListings(makeProduct({ dimensions: null, size: '40 20' }), MP)
      const lw = (listings[0].attributes.item_length_width as any)[0]
      expect(lw.length.value).toBe(40)
      expect(lw.width.value).toBe(20)
    })

    it('defaults dims to 25x10 when no numbers', () => {
      const listings = productToAmazonListings(makeProduct({ dimensions: 'abc', size: null }), MP)
      const lw = (listings[0].attributes.item_length_width as any)[0]
      expect(lw.length.value).toBe(25)
      expect(lw.width.value).toBe(10)
    })

    it('item_type_name uses category name', () => {
      const listings = productToAmazonListings(makeProduct({ categories: { name: 'Bolts' } }), MP)
      expect((listings[0].attributes.item_type_name as any)[0].value).toBe('Bolts')
    })

    it('item_type_name defaults to Fastener when no category', () => {
      const listings = productToAmazonListings(makeProduct({ categories: null }), MP)
      expect((listings[0].attributes.item_type_name as any)[0].value).toBe('Fastener')
    })
  })

  describe('image attributes', () => {
    it('sets main image from primary and others', () => {
      const listings = productToAmazonListings(
        makeProduct({
          product_images: [
            { id: 'i1', image_url: 'https://x/1.jpg', is_primary: true },
            { id: 'i2', image_url: 'https://x/2.jpg', is_primary: false },
            { id: 'i3', image_url: 'https://x/3.jpg', is_primary: false },
          ],
        }),
        MP
      )
      expect((listings[0].attributes.main_product_image_locator as any)[0].media_location).toBe('https://x/1.jpg')
      expect(listings[0].attributes.other_product_image_locator_1).toBeDefined()
      expect(listings[0].attributes.other_product_image_locator_2).toBeDefined()
    })

    it('falls back to first image when none is primary', () => {
      const listings = productToAmazonListings(
        makeProduct({
          product_images: [{ id: 'i1', image_url: 'https://x/first.jpg', is_primary: false }],
        }),
        MP
      )
      expect((listings[0].attributes.main_product_image_locator as any)[0].media_location).toBe('https://x/first.jpg')
    })

    it('sets no image attrs when no images', () => {
      const listings = productToAmazonListings(makeProduct({ product_images: [] }), MP)
      expect(listings[0].attributes.main_product_image_locator).toBeUndefined()
    })

    it('filters out images without image_url', () => {
      const listings = productToAmazonListings(
        makeProduct({
          product_images: [{ id: 'i1', image_url: null, is_primary: true }],
        }),
        MP
      )
      expect(listings[0].attributes.main_product_image_locator).toBeUndefined()
    })
  })

  describe('productToAmazonListings - variant product', () => {
    function makeVariantProduct(variants: any[]) {
      return makeProduct({
        has_variants: true,
        product_variants: variants,
      })
    }

    it('returns parent + one child per priced variant', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([
          { sku: 'V1', variant_name: 'Small', price: 100, mrp: 120, stock_status: 'In Stock' },
          { sku: 'V2', variant_name: 'Large', price: 150, mrp: null, stock_status: 'Out of Stock' },
        ]),
        MP
      )
      expect(listings).toHaveLength(3)
      expect((listings[0].attributes.parentage_level as any)[0].value).toBe('parent')
      expect((listings[1].attributes.parentage_level as any)[0].value).toBe('child')
    })

    it('parent has no purchasable_offer', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: 120, stock_status: 'In Stock' }]),
        MP
      )
      expect(listings[0].attributes.purchasable_offer).toBeUndefined()
    })

    it('skips variants with null price', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([
          { sku: 'V1', variant_name: 'Small', price: null, mrp: null, stock_status: 'In Stock' },
          { sku: 'V2', variant_name: 'Large', price: 150, mrp: 180, stock_status: 'In Stock' },
        ]),
        MP
      )
      // parent + only V2
      expect(listings).toHaveLength(2)
      expect(listings[1].sku).toBe('V2')
    })

    it('child item_name combines product + variant name', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: 120, stock_status: 'In Stock' }]),
        MP
      )
      expect((listings[1].attributes.item_name as any)[0].value).toBe('Hex Bolt M12 - Small')
    })

    it('child sets size when variant_name present', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: 120, stock_status: 'In Stock' }]),
        MP
      )
      expect((listings[1].attributes.size as any)[0].value).toBe('Small')
    })

    it('child omits size when variant_name absent', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: '', price: 100, mrp: 120, stock_status: 'In Stock' }]),
        MP
      )
      expect(listings[1].attributes.size).toBeUndefined()
    })

    it('variant mrp fallback to product mrp when variant.mrp absent', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: null, stock_status: 'In Stock' }]),
        MP
      )
      // product.mrp=120 > 100 => sale, mrp side = 120
      const offer = (listings[1].attributes.purchasable_offer as any)[0]
      expect(offer.maximum_retail_price[0].schedule[0].value_with_tax).toBe(120)
    })

    it('uses variant.mrp when present', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: 200, stock_status: 'In Stock' }]),
        MP
      )
      const offer = (listings[1].attributes.purchasable_offer as any)[0]
      expect(offer.maximum_retail_price[0].schedule[0].value_with_tax).toBe(200)
    })

    it('no variant mrp and no product mrp => listPrice = price', () => {
      const listings = productToAmazonListings(
        makeProduct({
          has_variants: true,
          mrp: null,
          product_variants: [{ sku: 'V1', variant_name: 'Small', price: 100, mrp: null, stock_status: 'In Stock' }],
        }),
        MP
      )
      const offer = (listings[1].attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(100)
    })

    it('child out of stock quantity 0', () => {
      const listings = productToAmazonListings(
        makeVariantProduct([{ sku: 'V1', variant_name: 'Small', price: 100, mrp: 120, stock_status: 'Out of Stock' }]),
        MP
      )
      expect((listings[1].attributes.fulfillment_availability as any)[0].quantity).toBe(0)
    })

    it('falls back to simple product when has_variants but empty variants array', () => {
      const listings = productToAmazonListings(makeProduct({ has_variants: true, product_variants: [] }), MP)
      expect(listings).toHaveLength(1)
      expect(listings[0].attributes.parentage_level).toBeUndefined()
    })
  })

  describe('productToAmazonOfferListing', () => {
    it('builds offer-only listing with PRODUCT type', () => {
      const listing = productToAmazonOfferListing(makeProduct(), 'B01ASIN123', MP)
      expect(listing.productType).toBe('PRODUCT')
      expect(listing.requirements).toBe('LISTING_OFFER_ONLY')
      expect((listing.attributes.merchant_suggested_asin as any)[0].value).toBe('B01ASIN123')
    })

    it('uses variant sku/price/mrp/stock when variant given', () => {
      const listing = productToAmazonOfferListing(makeProduct(), 'B01', MP, {
        sku: 'VAR-1',
        price: 90,
        mrp: 130,
        stock_status: 'Out of Stock',
      })
      expect(listing.sku).toBe('VAR-1')
      expect((listing.attributes.fulfillment_availability as any)[0].quantity).toBe(0)
      const offer = (listing.attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(90)
      expect(offer.maximum_retail_price[0].schedule[0].value_with_tax).toBe(130)
    })

    it('uses product-level values when no variant', () => {
      const listing = productToAmazonOfferListing(makeProduct({ base_price: 55, mrp: null, sku: 'P-1' }), 'B02', MP)
      expect(listing.sku).toBe('P-1')
      const offer = (listing.attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(55)
    })

    it('variant with null price falls back to product base_price', () => {
      const listing = productToAmazonOfferListing(makeProduct({ base_price: 70 }), 'B03', MP, {
        sku: 'VAR',
        price: null,
        mrp: null,
        stock_status: 'In Stock',
      })
      const offer = (listing.attributes.purchasable_offer as any)[0]
      expect(offer.our_price[0].schedule[0].value_with_tax).toBe(70)
    })

    it('out of stock via product when inactive', () => {
      const listing = productToAmazonOfferListing(makeProduct({ is_active: false }), 'B04', MP)
      expect((listing.attributes.fulfillment_availability as any)[0].quantity).toBe(0)
    })

    it('variant stock_status undefined uses product stock_status', () => {
      const listing = productToAmazonOfferListing(makeProduct({ stock_status: 'Out of Stock' }), 'B05', MP, {
        sku: 'VAR',
        price: 10,
        mrp: null,
      })
      expect((listing.attributes.fulfillment_availability as any)[0].quantity).toBe(0)
    })
  })

  describe('productLink', () => {
    it('builds base link with slug', () => {
      expect(productLink(makeProduct({ slug: 'my-slug' }))).toContain('/products/my-slug')
    })

    it('appends encoded sku when provided', () => {
      const link = productLink(makeProduct({ slug: 'my-slug' }), 'SKU 1/2')
      expect(link).toContain('?sku=')
      expect(link).toContain(encodeURIComponent('SKU 1/2'))
    })
  })
})
