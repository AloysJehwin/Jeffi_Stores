import { describe, it, expect } from 'vitest'
import { heroSlideHref } from '@/lib/catalog/hero-slides'

describe('heroSlideHref', () => {
  it('a trimmed manual cta_url wins over every filter', () => {
    expect(heroSlideHref({ cta_url: '  /custom  ', filter_category: 'c1' })).toBe('/custom')
  })

  it('ignores a blank cta_url and falls through to filters', () => {
    expect(heroSlideHref({ cta_url: '   ', filter_category: 'c1' })).toBe('/products?category=c1')
  })

  it('assembles every filter param', () => {
    const href = heroSlideHref({
      filter_category: 'c',
      filter_brand: 'b',
      filter_grade: 'g',
      filter_material: 'm',
      filter_min_price: 100,
      filter_max_price: 500,
      filter_in_stock: true,
      filter_on_sale: true,
    })
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/products')
    expect(url.searchParams.get('category')).toBe('c')
    expect(url.searchParams.get('brand')).toBe('b')
    expect(url.searchParams.get('grade')).toBe('g')
    expect(url.searchParams.get('material')).toBe('m')
    expect(url.searchParams.get('minPrice')).toBe('100')
    expect(url.searchParams.get('maxPrice')).toBe('500')
    expect(url.searchParams.get('inStock')).toBe('1')
    expect(url.searchParams.get('onSale')).toBe('1')
  })

  it('treats min price of 0 as set (!= null) but false flags as unset', () => {
    expect(heroSlideHref({ filter_min_price: 0, filter_in_stock: false, filter_on_sale: false })).toBe('/products?minPrice=0')
  })

  it('returns bare /products when nothing is set', () => {
    expect(heroSlideHref({})).toBe('/products')
  })
})
