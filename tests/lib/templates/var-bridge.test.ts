import { describe, it, expect } from 'vitest'
import { bridgeVars } from '@/lib/templates/var-bridge'
import { recommendScore } from '@/lib/campaigns/template-hints'

describe('bridgeVars', () => {
  it('fills the other spelling without overriding an explicit value', () => {
    const v = bridgeVars({ couponCode: 'SAVE10', ctaUrl: 'https://x/c', product_name: 'Kurta', cart_url: 'https://x/cart' })
    expect(v.coupon_code).toBe('SAVE10')
    expect(v.productName).toBe('Kurta')
    expect(v.cart_url).toBe('https://x/cart')
    expect(v.product_url).toBe('https://x/c')
  })
})

describe('recommendScore', () => {
  it('ranks the campaign template, then hints, then prefixes', () => {
    expect(recommendScore('abandoned_cart', 'email', 'campaign/abandoned_cart')).toBe(3)
    expect(recommendScore('price_drop', 'email', 'price-drop')).toBe(2)
    expect(recommendScore('abandoned_cart', 'email', 'cart/abandoned-final')).toBe(1)
    expect(recommendScore('abandoned_cart', 'whatsapp', 'cart/abandoned')).toBeGreaterThan(0)
    expect(recommendScore('abandoned_cart', 'email', 'order/confirmed')).toBe(0)
  })
})

import { missingRequired } from '@/lib/campaigns/kind-variables'

describe('missingRequired', () => {
  it('flags the variables a campaign kind depends on', () => {
    expect(missingRequired('abandoned_cart', 'email', 'Hi {firstName} <a href="{ctaUrl}">go</a>')).toEqual(['itemsHtml'])
    expect(missingRequired('restock', 'email', '{productCard} {{ctaUrl}}')).toEqual([])
    expect(missingRequired('messaging', 'email', '')).toEqual([])
  })
})
