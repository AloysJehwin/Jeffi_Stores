import { describe, it, expect, vi } from 'vitest'

// Use the real pricing/gst helpers — they are pure and simple.
vi.mock('@/lib/catalog/pricing', async () => {
  const actual = await vi.importActual<any>('@/lib/catalog/pricing')
  return actual
})

import { productCardProps, cardPropsFor } from '@/lib/catalog/product-card-props'

const base = {
  id: 'p1',
  name: 'Wire',
  slug: 'wire',
  base_price: 100,
  stock_status: 'In Stock',
}

describe('productCardProps — price', () => {
  it('uses variant_min_price for a variant product', () => {
    const c = productCardProps({ ...base, has_variants: true, variant_min_price: '250', variant_stock_total: '7' }, true)
    expect(c.displayPrice).toBe(250)
    expect(c.hasVariants).toBe(true)
    expect(c.effectiveStock).toBe(7)
  })

  it('uses base_price (incl) for a simple product when GST on', () => {
    const c = productCardProps({ ...base, has_variants: false, base_price: 100, price_ex_gst: 90 }, true)
    expect(c.displayPrice).toBe(100)
  })

  it('uses ex-GST price for a simple product when GST off', () => {
    const c = productCardProps({ ...base, has_variants: false, base_price: 100, price_ex_gst: 90 }, false)
    expect(c.displayPrice).toBe(90)
  })
})

describe('productCardProps — stock', () => {
  it('simple product in stock is 1, out of stock is 0', () => {
    expect(productCardProps({ ...base, has_variants: false, stock_status: 'In Stock' }, true).effectiveStock).toBe(1)
    expect(productCardProps({ ...base, has_variants: false, stock_status: 'Out of Stock' }, true).effectiveStock).toBe(0)
  })
})

describe('productCardProps — mrp and discount', () => {
  it('computes discount from raw mrp when GST on', () => {
    const c = productCardProps({ ...base, has_variants: false, base_price: 80, mrp: 100, gst_percentage: 18 }, true)
    expect(c.mrp).toBe(100)
    expect(c.mrpDiscount).toBe(20)
  })

  it('re-bases mrp to ex-GST when GST off and a rate is set', () => {
    // 118 / 1.18 = 100 ex-GST; displayPrice 100 → no discount
    const c = productCardProps({ ...base, has_variants: false, base_price: 100, price_ex_gst: 100, mrp: 118, gst_percentage: 18 }, false)
    expect(c.mrp).toBe(100)
    expect(c.mrpDiscount).toBe(0)
  })

  it('falls back to variant_min_mrp and gives 0 discount when no mrp', () => {
    const c = productCardProps({ ...base, has_variants: true, variant_min_price: 50, variant_stock_total: 1, variant_min_mrp: 60 }, true)
    expect(c.mrp).toBe(60)
    expect(c.mrpDiscount).toBe(Math.round(((60 - 50) / 60) * 100))
    const noMrp = productCardProps({ ...base, has_variants: false }, true)
    expect(noMrp.mrp).toBeNull()
    expect(noMrp.mrpDiscount).toBe(0)
  })
})

describe('productCardProps — images & misc fields', () => {
  it('prefers the primary image, else the first', () => {
    const imgs = [{ image_url: 'a' }, { image_url: 'b', is_primary: true }]
    expect(productCardProps({ ...base, product_images: imgs }, true).primaryImage).toEqual({ image_url: 'b', is_primary: true })
    expect(productCardProps({ ...base, product_images: [{ image_url: 'a' }] }, true).primaryImage).toEqual({ image_url: 'a' })
    expect(productCardProps({ ...base }, true).primaryImage).toBeNull()
  })

  it('maps brand, category, delivery and digital flags', () => {
    const c = productCardProps(
      { ...base, brands: { name: 'Acme' }, categories: { id: 'cx', name: 'Cat' }, discount_pct: '5', extra_delivery_days: '2', is_digital: 1 },
      true
    )
    expect(c.brandName).toBe('Acme')
    expect(c.categoryName).toBe('Cat')
    expect(c.categoryId).toBe('cx')
    expect(c.discountPct).toBe(5)
    expect(c.extraDeliveryDays).toBe(2)
    expect(c.isDigital).toBe(true)
  })

  it('prefers category_id over categories.id, nulls when neither', () => {
    expect(productCardProps({ ...base, category_id: 'direct', categories: { id: 'cx' } }, true).categoryId).toBe('direct')
    expect(productCardProps({ ...base }, true).categoryId).toBeNull()
    expect(productCardProps({ ...base }, true).brandName).toBeNull()
  })
})

describe('cardPropsFor', () => {
  it('keeps only display fields of the primary image', () => {
    const rows = [
      { ...base, product_images: [{ image_url: 'u', thumbnail_url: 't', blurhash: 'bh', storage_key: 'secret', is_primary: true }] },
    ]
    const out = cardPropsFor(rows, true)
    expect(out[0].primaryImage).toEqual({ image_url: 'u', thumbnail_url: 't', blurhash: 'bh' })
  })

  it('nulls the image when there is no image_url', () => {
    const out = cardPropsFor([{ ...base }], true)
    expect(out[0].primaryImage).toBeNull()
  })

  it('defaults blurhash to null', () => {
    const out = cardPropsFor([{ ...base, product_images: [{ image_url: 'u', thumbnail_url: 't' }] }], true)
    expect(out[0].primaryImage).toEqual({ image_url: 'u', thumbnail_url: 't', blurhash: null })
  })
})
