import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// motion runs the sheet's entry through the Web Animations API; happy-dom cancels it on unmount and the
// rejected `finished` surfaced as unhandled AbortErrors that failed the whole run. A plain div is enough here.
vi.mock('motion/react', () => ({
  useReducedMotion: () => false,
  motion: { div: ({ initial: _i, animate: _a, transition: _t, ...rest }: any) => <div {...rest} /> },
}))
const addToCart = vi.fn()
let cartItems: any[] = []
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart, cartItems }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let gstEnabled = true
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled } }) }))
const trackAddToCart = vi.fn()
vi.mock('@/lib/client/analytics', () => ({ trackAddToCart: (...a: any[]) => trackAddToCart(...a) }))
const startBuyNow = vi.fn()
vi.mock('@/lib/client/buy-now', () => ({ startBuyNow: (...a: any[]) => startBuyNow(...a) }))
const like = { isInWishlist: false, wishlistLoading: false, handleWishlist: vi.fn(), handleShare: vi.fn() }
vi.mock('@/components/visitor/useProductLikeShare', () => ({ useProductLikeShare: () => like }))
vi.mock('@/components/shared/QuantityInput', () => ({
  default: ({ quantity, qtyMin, qtyMax, onChange }: any) => (
    <div>
      <output data-testid="qty">{quantity}</output>
      <span data-testid="bounds">{`${qtyMin}-${qtyMax ?? 'inf'}`}</span>
      <button onClick={() => onChange(quantity + 1, String(quantity + 1))}>qty+</button>
    </div>
  ),
}))
vi.mock('@/components/shared/InCartQtyHint', () => ({ default: ({ cap }: any) => (cap.inCart ? <p>{`${cap.inCart} in cart`}</p> : null) }))

import QuickAddPicker, { QuickAddHeaderActions } from '@/components/visitor/QuickAddPicker'

const fetchMock = vi.fn()
const variant = (id: string, over: Record<string, any> = {}) => ({
  id, variant_name: `Var ${id}`, sku: `SKU-${id}`, price: 1180, mrp: 1500, price_ex_gst: 1000, stock_status: 'In Stock', variant_type: 'Size', sub_variants: [], ...over,
})
const load = (data: any) => fetchMock.mockResolvedValue({ ok: true, json: async () => data })
const onClose = vi.fn()
const onStop = vi.fn()
const renderPicker = (props: Record<string, any> = {}) =>
  render(<QuickAddPicker productId="p1" productName="Halo Speaker" slug="halo speaker" onClose={onClose} onStop={onStop} {...props} />)

describe('QuickAddPicker', () => {
  beforeEach(() => {
    for (const m of [fetchMock, push, addToCart, showToast, trackAddToCart, startBuyNow, onClose, onStop, like.handleWishlist, like.handleShare]) m.mockReset()
    cartItems = []
    gstEnabled = true
    like.isInWishlist = false
    like.wishlistLoading = false
    addToCart.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
  })

  it('is a modal dialog showing the product header info and a loading state while options load', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    renderPicker({ brandName: 'Halo', categoryName: 'Audio', imageUrl: '/s.png', displayPrice: 1000, mrp: 1500, discountPct: 33, inStock: true })
    expect(screen.getByRole('dialog', { name: 'Quick add to cart' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Halo Speaker')).toBeInTheDocument()
    expect(screen.getByText('Halo')).toBeInTheDocument()
    expect(screen.getByAltText('Halo Speaker')).toHaveAttribute('src', '/s.png')
    expect(screen.getByText('From Rs. 1,000.00')).toBeInTheDocument()
    expect(screen.getByText('Rs. 1,500.00')).toHaveClass('line-through')
    expect(screen.getByText('33% off')).toBeInTheDocument()
    expect(screen.getByText('In Stock')).toBeInTheDocument()
    expect(screen.getByText('Loading options...')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/slug/halo%20speaker/variants')
  })

  it('shows an out-of-stock chip', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    renderPicker({ displayPrice: 10, inStock: false })
    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
  })

  it('shows an error with a link to the product when options fail to load', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    renderPicker()
    expect(await screen.findByText('Could not load options.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View product' })).toHaveAttribute('href', '/products/halo speaker')
  })

  it('preselects the first in-stock variant and prices it with GST included', async () => {
    load({ product_variants: [variant('a', { stock_status: 'Out of Stock' }), variant('b'), variant('c', { price: 2000 })], product_units: [] })
    renderPicker()
    expect(await screen.findByText('Select Size')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Var b' }).className).toContain('bg-accent-500')
    expect(screen.getByRole('button', { name: /Var a \(Out of Stock\)/ })).toBeInTheDocument()
    expect(screen.getByText('Rs. 1,180.00')).toBeInTheDocument()
  })

  it('shows the ex-GST price when GST is off and recomputes when another variant is picked', async () => {
    gstEnabled = false
    load({ product_variants: [variant('a'), variant('b', { price_ex_gst: 400, price: 472 })], product_units: [] })
    renderPicker()
    expect(await screen.findByText('Rs. 1,000.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Var b' }))
    expect(screen.getByText('Rs. 400.00')).toBeInTheDocument()
    expect(onStop).toHaveBeenCalled()
  })

  it('shows sub-variants for the chosen variant and switches the price with them', async () => {
    load({
      product_variants: [
        variant('a', {
          sub_variant_type: 'Colour',
          sub_variants: [
            { id: 's1', sub_variant_name: 'Black', price: 1180, mrp: null, price_ex_gst: null, stock_status: 'Out of Stock', is_active: true },
            { id: 's2', sub_variant_name: 'White', price: 1300, mrp: null, price_ex_gst: null, stock_status: 'In Stock', is_active: true },
          ],
        }),
        variant('b'),
      ],
      product_units: [],
    })
    renderPicker()
    expect(await screen.findByText('Select Colour')).toBeInTheDocument()
    expect(screen.getByText('Rs. 1,300.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Black/ }))
    expect(screen.getByText('Rs. 1,180.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Var b' }))
    expect(screen.queryByText('Select Colour')).not.toBeInTheDocument()
  })

  it('adds the chosen quantity to the cart, tracks it, toasts and closes', async () => {
    load({ product_variants: [variant('a')], product_units: [] })
    renderPicker()
    await screen.findByText('Select Size')
    fireEvent.click(screen.getByRole('button', { name: 'qty+' }))
    expect(screen.getByTestId('qty')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item added to cart!', 'success'))
    expect(addToCart).toHaveBeenCalledWith('p1', 2, 'a', 'unit', 'unit', undefined)
    expect(trackAddToCart).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-a', name: 'Halo Speaker', quantity: 2, price: 1180, variant: 'Var a' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces the cart error and stays open', async () => {
    load({ product_variants: [variant('a')], product_units: [] })
    addToCart.mockRejectedValue(new Error('Only 1 left'))
    renderPicker()
    await screen.findByText('Select Size')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Only 1 left', 'error'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled()
  })

  it('uses the unit factor for the shown price and a per-unit label for non-generic units', async () => {
    load({
      product_variants: [variant('a', { price: 100 })],
      product_units: [
        { id: 'u1', variant_id: 'a', sub_variant_id: null, unit: 'box', factor: 12, is_base: true, is_purchase_default: true, display_label: 'box', dimension: 'count' },
        { id: 'u0', variant_id: 'a', sub_variant_id: null, unit: 'gram', factor: 1, is_base: false, is_purchase_default: false, display_label: 'g', dimension: 'count' },
      ],
    })
    renderPicker()
    expect(await screen.findByText('Rs. 1,200.00')).toBeInTheDocument()
    expect(screen.getByText(/\/\s*g$/)).toBeInTheDocument()
  })

  it('caps the quantity by what is already in the cart and disables adding when the line is full', async () => {
    load({
      product_variants: [variant('a')],
      product_units: [{ id: 'u1', variant_id: null, sub_variant_id: null, unit: 'unit', factor: 1, is_base: true, is_purchase_default: true, display_label: null, dimension: 'count', max_qty: 3 }],
    })
    cartItems = [{ product_id: 'p1', variant_id: 'a', sub_variant_id: null, buy_mode: 'unit', quantity: 3 }]
    renderPicker()
    const btn = await screen.findByRole('button', { name: 'Max quantity already in cart' })
    expect(btn).toBeDisabled()
    expect(screen.getByText('3 in cart')).toBeInTheDocument()
    expect(screen.queryByTestId('qty')).not.toBeInTheDocument()
  })

  it('a partly filled line still allows adding up to the cap', async () => {
    load({
      product_variants: [variant('a')],
      product_units: [{ id: 'u1', variant_id: null, sub_variant_id: null, unit: 'unit', factor: 1, is_base: true, is_purchase_default: true, display_label: null, dimension: 'count', max_qty: 5 }],
    })
    cartItems = [{ product_id: 'p1', variant_id: 'a', sub_variant_id: null, buy_mode: 'unit', quantity: 2 }]
    renderPicker()
    await screen.findByText('Select Size')
    expect(screen.getByTestId('bounds')).toHaveTextContent('1-3')
  })

  it('digital products buy now instead of adding to cart, then navigate', async () => {
    load({ product_variants: [variant('a')], product_units: [], is_digital: true })
    startBuyNow.mockResolvedValue({ ok: true, href: '/checkout?buy=1' })
    renderPicker({ portal: 'business' })
    expect(await screen.findByRole('dialog', { name: 'Quick buy' })).toBeInTheDocument()
    expect(screen.queryByTestId('qty')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout?buy=1'))
    expect(startBuyNow).toHaveBeenCalledWith({ productId: 'p1', variantId: 'a', subVariantId: null, qty: 1 }, 'business')
    expect(addToCart).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed buy-now toasts the error and re-enables the button', async () => {
    load({ product_variants: [variant('a')], product_units: [] })
    startBuyNow.mockResolvedValue({ ok: false, error: 'Sign in first' })
    renderPicker({ isDigital: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Sign in first', 'error'))
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeEnabled()
  })

  it('closes from the backdrop', async () => {
    load({ product_variants: [variant('a')], product_units: [] })
    const { baseElement } = renderPicker()
    await screen.findByText('Select Size')
    fireEvent.click(baseElement.querySelector('.bg-black\\/50')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('requires a sub-variant selection when none can be picked', async () => {
    load({
      product_variants: [variant('a', { sub_variant_type: 'Colour', sub_variants: [{ id: 's1', sub_variant_name: 'Black', price: 1, mrp: null, price_ex_gst: null, stock_status: 'In Stock', is_active: false }] })],
      product_units: [],
    })
    renderPicker()
    await screen.findByText('Select Colour')
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    await waitFor(() => expect(addToCart).toHaveBeenCalled())
  })
})

describe('QuickAddHeaderActions', () => {
  const setup = (showWishlist: boolean) =>
    render(<QuickAddHeaderActions productId="p1" productName="Halo" slug="halo" href="/products/halo" showWishlist={showWishlist} onClose={onClose} onStop={onStop} />)

  beforeEach(() => {
    for (const m of [onClose, onStop, like.handleWishlist, like.handleShare]) m.mockReset()
    like.isInWishlist = false
    like.wishlistLoading = false
  })

  it('storefront shows wishlist, share and close; wishlist toggles', () => {
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(like.handleWishlist).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    expect(like.handleShare).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onStop).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('reflects a wishlisted product and disables while loading', () => {
    like.isInWishlist = true
    like.wishlistLoading = true
    setup(true)
    const btn = screen.getByRole('button', { name: 'Remove from wishlist' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toBeDisabled()
  })

  it('the business portal has no wishlist button', () => {
    setup(false)
    expect(screen.queryByRole('button', { name: /wishlist/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share product' })).toBeInTheDocument()
  })
})
