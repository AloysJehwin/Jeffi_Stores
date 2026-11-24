import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const m = vi.hoisted(() => ({ quickAdd: null as any, like: { isInWishlist: false, wishlistLoading: false, handleWishlist: vi.fn() } }))

vi.mock('@/components/visitor/QuickAddButton', () => ({
  default: (p: any) => {
    m.quickAdd = p
    return <button aria-label={p.ariaLabel} className={p.buttonClassName}>{p.buttonContent}</button>
  },
}))
vi.mock('@/components/visitor/useProductLikeShare', () => ({ useProductLikeShare: () => m.like }))

import { QuickAddPart, WishlistTogglePart } from '@/components/visitor/site/code/parts/card/CardActions'

const product = { id: 'p1', slug: 'drill', name: 'Drill', image: '/d.jpg', brand: 'Bosch', category: 'Tools', price: 999, mrp: 1299, discountPct: 23, inStock: true, hasVariants: false, isDigital: false }

beforeEach(() => {
  m.like = { isInWishlist: false, wishlistLoading: false, handleWishlist: vi.fn() }
})

describe('QuickAddPart', () => {
  it('draws the quick add button with the design\'s words, icon and product details', () => {
    render(<QuickAddPart product={product} text="Add to bag" icon="bag" portal="storefront" />)
    const button = screen.getByRole('button', { name: 'Add to bag: Drill' })
    expect(button).toHaveTextContent('Add to bag')
    expect(button.querySelector('svg')).toBeInTheDocument()
    expect(button.className).toContain('relative z-10')
    expect(m.quickAdd).toMatchObject({ productId: 'p1', slug: 'drill', imageUrl: '/d.jpg', brandName: 'Bosch', categoryName: 'Tools', displayPrice: 999, mrp: 1299, discountPct: 23, portal: 'storefront', quick: true })
  })

  it('names the action by the product when the design gives no words', () => {
    render(<QuickAddPart product={{ ...product, hasVariants: true }} text="" icon="none" portal="business" />)
    expect(screen.getByRole('button', { name: 'Choose options: Drill' })).toBeInTheDocument()
    expect(screen.getByRole('button').querySelector('svg')).toBeNull()
  })

  it('keeps an AI class above the stretched link', () => {
    render(<QuickAddPart product={product} text="Buy" icon="plus" className="absolute right-2 top-2" portal="storefront" />)
    expect(screen.getByRole('button').className).toBe('z-10 absolute right-2 top-2')
  })
})

describe('WishlistTogglePart', () => {
  it('saves the product to the wishlist on click and offers a descriptive label', () => {
    render(<WishlistTogglePart product={product} />)
    const button = screen.getByRole('button', { name: 'Save Drill to your wishlist' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(m.like.handleWishlist).toHaveBeenCalledTimes(1)
  })

  it('shows the saved state and offers removal', () => {
    m.like.isInWishlist = true
    render(<WishlistTogglePart product={product} />)
    const button = screen.getByRole('button', { name: 'Remove Drill from your wishlist' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.querySelector('svg')).toHaveAttribute('fill', 'currentColor')
  })

  it('shows the design\'s label as the name, and disables while loading', () => {
    m.like.wishlistLoading = true
    render(<WishlistTogglePart product={product} label="Wishlist" className="my-heart" />)
    const button = screen.getByRole('button', { name: 'Wishlist' })
    expect(button).toBeDisabled()
    expect(button.className).toContain('my-heart')
  })
})
