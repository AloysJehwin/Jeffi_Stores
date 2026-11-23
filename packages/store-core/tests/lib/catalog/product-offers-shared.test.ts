import { describe, it, expect } from 'vitest'
import { offerHref, slugifyOffer } from '@/lib/catalog/product-offers-shared'

describe('offerHref', () => {
  it('builds an encoded products filter link', () => {
    expect(offerHref('big-sale')).toBe('/products?offer=big-sale')
    expect(offerHref('a b/c')).toBe('/products?offer=a%20b%2Fc')
  })
})

describe('slugifyOffer', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyOffer('Big Summer Sale')).toBe('big-summer-sale')
  })
  it('strips leading/trailing hyphens and collapses non-alphanumerics', () => {
    expect(slugifyOffer('  !!Hot--Deals!! ')).toBe('hot-deals')
  })
  it('truncates to 200 chars', () => {
    expect(slugifyOffer('a'.repeat(300)).length).toBe(200)
  })
  it('falls back to "offer" when empty after slugify', () => {
    expect(slugifyOffer('!!!')).toBe('offer')
    expect(slugifyOffer('')).toBe('offer')
  })
})
