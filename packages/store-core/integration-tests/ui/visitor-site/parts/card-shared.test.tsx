import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  cardProduct,
  quickAddText,
  aboveLink,
  CardIcon,
  QUICK_ADD_CLASS,
  WISHLIST_CLASS,
} from '@/components/visitor/site/code/parts/card/shared'

const view = (over: any = {}) => ({
  id: 'p1',
  slug: 'drill',
  name: 'Drill',
  image: '/d.jpg',
  brand: 'Bosch',
  category: 'Tools',
  price: { value: 999 },
  mrp: { value: 1299 },
  discountPct: 23,
  inStock: true,
  hasVariants: false,
  isDigital: false,
  ...over,
})

describe('cardProduct', () => {
  it('reduces a product view to the plain fields the card buttons need', () => {
    expect(cardProduct(view())).toEqual({
      id: 'p1', slug: 'drill', name: 'Drill', image: '/d.jpg', brand: 'Bosch', category: 'Tools',
      price: 999, mrp: 1299, discountPct: 23, inStock: true, hasVariants: false, isDigital: false,
    })
  })

  it('returns null for something that is not a product', () => {
    for (const v of [null, undefined, 'x', 3, {}, { id: 'a', slug: 'b' }, { id: 1, slug: 's', name: 'n' }]) expect(cardProduct(v)).toBeNull()
  })

  it('defaults the optional fields', () => {
    const p = cardProduct({ id: 'a', slug: 's', name: 'n' })
    expect(p).toMatchObject({ image: null, brand: null, category: null, price: 0, mrp: null, discountPct: 0, inStock: true, hasVariants: false, isDigital: false })
  })

  it('drops a zero MRP and honours stock, variants and digital flags', () => {
    const p = cardProduct(view({ mrp: { value: 0 }, inStock: false, hasVariants: true, isDigital: true }))
    expect(p).toMatchObject({ mrp: null, inStock: false, hasVariants: true, isDigital: true })
  })
})

describe('quickAddText', () => {
  const base = { inStock: true, hasVariants: false, isDigital: false } as any
  it('names what a tap does for the product', () => {
    expect(quickAddText(base)).toBe('Add to cart')
    expect(quickAddText({ ...base, hasVariants: true })).toBe('Choose options')
    expect(quickAddText({ ...base, isDigital: true })).toBe('Buy now')
    expect(quickAddText({ ...base, inStock: false, hasVariants: true })).toBe('Sold out')
  })
})

describe('aboveLink', () => {
  it('adds relative z-10 to keep a button above the card link', () => {
    expect(aboveLink('px-4 py-2')).toBe('relative z-10 px-4 py-2')
  })

  it('does not add relative when the classes already position the button', () => {
    for (const cls of ['absolute right-2', 'fixed top-0', 'sticky top-0', 'relative p-2', '!absolute x']) {
      expect(aboveLink(cls)).toBe(`z-10 ${cls}`)
    }
  })

  it('treats a breakpoint-only position as not positioned', () => {
    expect(aboveLink('md:absolute p-2')).toBe('relative z-10 md:absolute p-2')
  })
})

describe('CardIcon / default classes', () => {
  it('draws the named icon, or nothing for none', () => {
    const { container, rerender } = render(<CardIcon name="cart" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    rerender(<CardIcon name="plus" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    rerender(<CardIcon name="none" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('exports the default button classes', () => {
    expect(QUICK_ADD_CLASS).toContain('min-h-[44px]')
    expect(WISHLIST_CLASS).toContain('rounded-full')
  })
})
