import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  offerIdFromSku,
  toGaItems,
  trackAddToCart,
  trackBeginCheckout,
  trackPurchase,
  trackViewItem,
} from '@/lib/client/analytics'
import { productToGmcItems } from '@/lib/merchant/mapper'

type W = { gtag?: ReturnType<typeof vi.fn>; jeffiAds?: { sendTo: string | null } }
const w = window as unknown as W

const order = {
  orderNumber: 'ORD-1-ABC',
  totalAmount: 1180.5,
  taxAmount: 180,
  shippingAmount: 50,
  items: [
    { sku: 'BOLT M8/20', name: 'Hex bolt', price: 10.5, quantity: 100, variant: 'M8' },
    { sku: null, name: 'Gift wrap', price: 5 },
  ],
}

beforeEach(() => {
  localStorage.clear()
  w.gtag = vi.fn()
  delete w.jeffiAds
})

describe('item ids', () => {
  it('match the offerId Merchant sync sends', () => {
    const [simple] = productToGmcItems(
      { name: 'Bolt', slug: 'bolt', sku: 'BOLT M8/20', base_price: 10, product_images: [] },
      'https://x.in'
    )
    expect(offerIdFromSku('BOLT M8/20')).toBe(simple.offerId)
    const variants = productToGmcItems(
      {
        name: 'Bolt',
        slug: 'bolt',
        sku: 'BOLT',
        base_price: 10,
        has_variants: true,
        product_images: [],
        product_variants: [{ sku: 'BOLT#M8 (zinc)', variant_name: 'M8', price: 12 }],
      },
      'https://x.in'
    )
    expect(offerIdFromSku('BOLT#M8 (zinc)')).toBe(variants[0].offerId)
  })

  it('skip lines without a SKU', () => {
    expect(toGaItems(order.items).map(i => i.item_id)).toEqual(['BOLT_M8_20'])
  })
})

describe('trackPurchase', () => {
  it('sends purchase with order number, total and INR, once per order', () => {
    expect(trackPurchase(order)).toBe(true)
    expect(w.gtag).toHaveBeenCalledWith('event', 'purchase', {
      transaction_id: 'ORD-1-ABC',
      value: 1180.5,
      currency: 'INR',
      tax: 180,
      shipping: 50,
      items: [
        { item_id: 'BOLT_M8_20', item_name: 'Hex bolt', item_variant: 'M8', price: 10.5, quantity: 100, index: 0 },
      ],
    })
    expect(trackPurchase(order)).toBe(false)
    expect(w.gtag).toHaveBeenCalledTimes(1)
  })

  it('also sends the Ads conversion when send_to is configured', () => {
    w.jeffiAds = { sendTo: 'AW-111222333/lbl_123' }
    trackPurchase(order)
    expect(w.gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: 'AW-111222333/lbl_123',
      value: 1180.5,
      currency: 'INR',
      transaction_id: 'ORD-1-ABC',
    })
  })

  it('does not mark an order as sent when no tag is loaded', () => {
    delete w.gtag
    expect(trackPurchase(order)).toBe(false)
    w.gtag = vi.fn()
    expect(trackPurchase(order)).toBe(true)
  })

  it('keeps only the most recent orders in its guard list', () => {
    for (let i = 0; i < 60; i++) trackPurchase({ ...order, orderNumber: `ORD-${i}` })
    expect(JSON.parse(localStorage.getItem('jeffi_ga_purchased')!)).toHaveLength(50)
  })
})

describe('funnel events', () => {
  it('view_item / add_to_cart / begin_checkout carry value and item ids', () => {
    trackViewItem({ sku: 'A-1', name: 'A', price: 99.999 })
    expect(w.gtag).toHaveBeenLastCalledWith('event', 'view_item', {
      currency: 'INR',
      value: 100,
      items: [{ item_id: 'A-1', item_name: 'A', price: 100, quantity: 1, index: 0 }],
    })
    trackAddToCart({ sku: 'A-1', name: 'A', price: 10, quantity: 3 })
    expect(w.gtag).toHaveBeenLastCalledWith('event', 'add_to_cart', expect.objectContaining({ value: 30 }))
    trackBeginCheckout([
      { sku: 'A-1', name: 'A', price: 10, quantity: 2 },
      { sku: 'B-2', name: 'B', price: 5 },
    ])
    expect(w.gtag).toHaveBeenLastCalledWith('event', 'begin_checkout', expect.objectContaining({ value: 25 }))
  })

  it('no-ops without a SKU or a tag', () => {
    expect(trackViewItem({ sku: '', name: 'A', price: 1 })).toBe(false)
    delete w.gtag
    expect(trackAddToCart({ sku: 'A', name: 'A', price: 1 })).toBe(false)
  })
})
