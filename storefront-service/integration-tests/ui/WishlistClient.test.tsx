import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const addToCart = vi.fn()
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
const wl = { remove: vi.fn(), has: vi.fn(), ready: true }
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => wl }))
vi.mock('@/contexts/AccountSearchContext', () => ({ AccountSearchProvider: ({ children }: any) => <>{children}</> }))
vi.mock('@/components/visitor/AccountSidebar', () => ({ AccountNavBar: () => <div data-testid="navbar" /> }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({
  default: () => <div data-testid="mobile-header" />,
  AccountMobileTabBar: () => <div data-testid="tab-bar" />,
}))
vi.mock('@/components/visitor/FeaturedProducts', () => ({ default: () => <div data-testid="featured" /> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: ({ fragile }: any) => (fragile ? <span>fragile</span> : null) }))
vi.mock('@/components/visitor/skeletons/account', () => ({ WishlistSkeleton: () => <div role="status">loading wishlist</div> }))
const startBuyNow = vi.fn()
vi.mock('@/lib/client/buy-now', () => ({ startBuyNow: (...a: any[]) => startBuyNow(...a) }))

import WishlistClient from '@storefront/app/(storefront)/wishlist/WishlistClient'

const fetchMock = vi.fn()
const item = (i: number, over: Record<string, any> = {}, prod: Record<string, any> = {}) => ({
  id: `w${i}`, product_id: `p${i}`, snapshot_price: null, snapshot_in_stock: null, inventory_in_stock: null,
  products: {
    id: `p${i}`, name: `Product ${i}`, slug: `product-${i}`, base_price: 1180, price_ex_gst: 1000, mrp: 1500, has_variants: false, stock_status: 'In Stock',
    variant_stock_total: 0, variant_min_price: null, variant_min_mrp: null, product_images: [{ thumbnail_url: `/t${i}.png`, is_primary: true }], fragile: null, hazardous: null, flammable: null, ...prod,
  },
  ...over,
})
const load = (items: any[]) => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items }) })

describe('WishlistClient', () => {
  beforeEach(() => {
    for (const m of [push, addToCart, showToast, confirm, wl.remove, wl.has, startBuyNow, fetchMock]) m.mockReset()
    wl.ready = true
    wl.has.mockReturnValue(true)
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the skeleton while loading, then the empty state with a browse link', async () => {
    load([])
    render(<WishlistClient />)
    expect(screen.getByRole('status')).toHaveTextContent('loading wishlist')
    expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse Products' })).toHaveAttribute('href', '/products')
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlist')
  })

  it('falls back to the empty state when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<WishlistClient />)
    expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument()
  })

  it('lists saved products with price (ex-GST), MRP, discount, stock and the featured strip', async () => {
    load([item(1), item(2, {}, { has_variants: true, variant_min_price: 800, variant_stock_total: 0, stock_status: 'In Stock', mrp: null })])
    render(<WishlistClient />)
    expect(await screen.findByRole('link', { name: 'Product 1' })).toHaveAttribute('href', '/products/product-1')
    expect(screen.getAllByTestId('mobile-header')).toHaveLength(1)
    expect(screen.getByText('₹1,000.00')).toBeInTheDocument()
    expect(screen.getByText('₹1,500.00')).toHaveClass('line-through')
    expect(screen.getByText('21% off')).toBeInTheDocument()
    expect(screen.getByText('From ₹800.00')).toBeInTheDocument()
    expect(screen.getAllByText('Inclusive of all taxes')).toHaveLength(2)
    expect(screen.getByTestId('featured')).toBeInTheDocument()
  })

  it('filters by stock', async () => {
    load([item(1), item(2, {}, { stock_status: 'Out of Stock' })])
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getByRole('button', { name: 'Out of Stock' }))
    expect(screen.queryByText('Product 1')).not.toBeInTheDocument()
    expect(screen.getByText('Product 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'In Stock' }))
    expect(screen.getByText('Product 1')).toBeInTheDocument()
    expect(screen.queryByText('Product 2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Product 2')).toBeInTheDocument()
  })

  it('moves a product to the cart: adds one, removes it from the wishlist, toasts', async () => {
    load([item(1), item(2)])
    addToCart.mockResolvedValue(undefined)
    wl.remove.mockResolvedValue(true)
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to Cart' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Moved to cart', 'success'))
    expect(addToCart).toHaveBeenCalledWith('p1', 1)
    expect(wl.remove).toHaveBeenCalledWith('p1')
    expect(screen.queryByText('Product 1')).not.toBeInTheDocument()
  })

  it('when it could not leave the wishlist it just says the item was added', async () => {
    load([item(1)])
    addToCart.mockResolvedValue(undefined)
    wl.remove.mockResolvedValue(false)
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item added to cart!', 'success'))
    expect(screen.getByText('Product 1')).toBeInTheDocument()
  })

  it('a cart failure toasts its message and re-enables the button', async () => {
    load([item(1)])
    addToCart.mockRejectedValue(new Error('Out of stock'))
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Out of stock', 'error'))
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled()
  })

  it('removal asks to confirm first; declining keeps the item, accepting removes it', async () => {
    load([item(1)])
    confirm.mockResolvedValueOnce(false)
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove from Wishlist', variant: 'danger' })))
    expect(wl.remove).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce(true)
    wl.remove.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item removed from wishlist', 'success'))
    expect(wl.remove).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument()
  })

  it('a failed removal toasts an error', async () => {
    load([item(1)])
    confirm.mockResolvedValue(true)
    wl.remove.mockResolvedValue(false)
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to remove item', 'error'))
    expect(screen.getByText('Product 1')).toBeInTheDocument()
  })

  it('shows Back in stock and Price dropped badges from the saved snapshot', async () => {
    load([item(1, { snapshot_in_stock: false, inventory_in_stock: true, snapshot_price: 1400 })])
    render(<WishlistClient />)
    expect(await screen.findByText('Back in stock')).toBeInTheDocument()
    expect(screen.getByText('Price dropped 16%')).toBeInTheDocument()
    expect(screen.getByText(/Was/)).toBeInTheDocument()
  })

  it('digital products offer Buy Now, which goes to checkout', async () => {
    load([item(1, {}, { is_digital: true })])
    startBuyNow.mockResolvedValue({ ok: true, href: '/checkout?buy=1' })
    render(<WishlistClient />)
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout?buy=1'))
    expect(startBuyNow).toHaveBeenCalledWith({ productId: 'p1', qty: 1 })
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('a failed Buy Now toasts and the button comes back; a digital product with variants opens its page', async () => {
    load([item(1, {}, { is_digital: true }), item(2, {}, { is_digital: true, has_variants: true, variant_stock_total: 3, variant_min_price: 500 })])
    startBuyNow.mockResolvedValue({ ok: false, error: 'Sign in first' })
    render(<WishlistClient />)
    await screen.findByText('Product 1')
    const buttons = screen.getAllByRole('button', { name: 'Buy Now' })
    fireEvent.click(buttons[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Sign in first', 'error'))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Buy Now' })[0]).toBeEnabled())
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy Now' })[1])
    expect(push).toHaveBeenCalledWith('/products/product-2')
  })

  describe('AI-designed wishlist (card mode)', () => {
    it('draws the server cards under a tab bar, with a Remove button per card and no featured strip', async () => {
      load([item(1), item(2)])
      const cards = vi.fn().mockResolvedValue({ styles: <style data-testid="card-styles" />, nodes: { p1: <div>card one</div>, p2: null } })
      render(<WishlistClient cards={cards} />)
      expect(await screen.findByText('card one')).toBeInTheDocument()
      expect(cards).toHaveBeenCalledWith(['p1', 'p2'])
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
      expect(screen.queryByTestId('mobile-header')).not.toBeInTheDocument()
      expect(screen.getByTestId('card-styles')).toBeInTheDocument()
      expect(screen.queryByTestId('featured')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove Product 1 from wishlist' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove Product 2 from wishlist' })).not.toBeInTheDocument()
    })

    it('products unsaved from a card\'s own heart leave the grid', async () => {
      load([item(1), item(2)])
      wl.has.mockImplementation((id: string) => id !== 'p1')
      const cards = vi.fn().mockResolvedValue({ styles: null, nodes: { p1: <div>card one</div>, p2: <div>card two</div> } })
      render(<WishlistClient cards={cards} />)
      expect(await screen.findByText('card two')).toBeInTheDocument()
      expect(screen.queryByText('card one')).not.toBeInTheDocument()
    })

    it('falls back to the built-in tiles when drawing the cards fails', async () => {
      load([item(1)])
      const cards = vi.fn().mockRejectedValue(new Error('boom'))
      render(<WishlistClient cards={cards} />)
      expect(await screen.findByRole('link', { name: 'Product 1' })).toBeInTheDocument()
      expect(screen.getByTestId('featured')).toBeInTheDocument()
    })

    it('an empty wishlist shows the empty state with the tab bar', async () => {
      load([])
      render(<WishlistClient cards={vi.fn()} />)
      expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument()
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
    })
  })
})
