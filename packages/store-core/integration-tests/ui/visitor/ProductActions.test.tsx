import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const addToCart = vi.fn()
let cartItems: any[] = []
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart, cartItems }) }))
const flyToCart = vi.fn()
vi.mock('@/contexts/FlyToCartContext', () => ({ useFlyToCart: () => ({ flyToCart }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let user: any = null
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
let gstEnabled = true
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled } }) }))
const trackAddToCart = vi.fn()
const trackViewItem = vi.fn()
vi.mock('@/lib/client/analytics', () => ({ trackAddToCart: (...a: any[]) => trackAddToCart(...a), trackViewItem: (...a: any[]) => trackViewItem(...a) }))
vi.mock('@/lib/shipping/edd-cache', () => ({ resolveEdd: vi.fn().mockResolvedValue(null) }))
vi.mock('@/components/shared/QuantityInput', () => ({
  default: ({ quantity, onChange }: any) => (
    <div>
      <output data-testid="qty">{quantity}</output>
      <button onClick={() => onChange(quantity + 1, String(quantity + 1))}>qty+</button>
    </div>
  ),
}))
vi.mock('@/components/shared/InCartQtyHint', () => ({ default: ({ cap }: any) => (cap.inCart ? <p>{`${cap.inCart} already in cart`}</p> : null) }))
vi.mock('@/components/visitor/pdp/StickyAddToCartBar', () => ({ default: ({ name, adding }: any) => <div data-testid="sticky">{`${name}:${adding}`}</div> }))
vi.mock('@/components/subscriptions/SubscribeOption', () => ({ default: ({ isSubscription }: any) => <div data-testid="subscribe">{String(isSubscription)}</div> }))

import ProductActions, { useProductPurchase, PurchaseButtons, PurchaseNotices } from '@/components/visitor/ProductActions'

const fetchMock = vi.fn()
const variant = (id: string, over: Record<string, any> = {}) => ({
  id, variant_name: `Var ${id}`, sku: `SKU-${id}`, price: 1180, mrp: 1500, mrp_ex_gst: 1271, price_ex_gst: 1000, stock_status: 'In Stock', variant_type: 'Size', sub_variants: [], ...over,
})
const base = (over: Record<string, any> = {}) => ({
  productId: 'p1', productName: 'Halo Speaker', sku: 'BASE', stockStatus: 'In Stock', basePrice: 1180, basePriceExGst: 1000, salePrice: null, mrp: 1500, gstPercentage: 18,
  variants: [], variantType: 'Variant', ...over,
})
function Harness(props: any) {
  const s = useProductPurchase(props)
  return <ProductActions s={s} />
}
const mount = (over: Record<string, any> = {}) => render(<Harness {...base(over)} />)

describe('ProductActions', () => {
  beforeEach(() => {
    for (const m of [push, addToCart, flyToCart, showToast, trackAddToCart, trackViewItem, fetchMock]) m.mockReset()
    cartItems = []
    user = null
    gstEnabled = true
    addToCart.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(null, '', '/products/halo')
  })

  it('a simple product shows its price and quantity and adds to the cart, flying the item and tracking it', async () => {
    mount()
    expect(screen.getAllByText('Rs. 1,180.00').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Select/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'qty+' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item added to cart!', 'success'))
    expect(addToCart).toHaveBeenCalledWith('p1', 2, undefined, 'unit', 'unit', undefined)
    expect(flyToCart).toHaveBeenCalled()
    expect(trackAddToCart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Halo Speaker', quantity: 2, price: 1180 }))
  })

  it('with GST off the ex-GST price is shown', () => {
    gstEnabled = false
    mount()
    expect(screen.getAllByText('Rs. 1,000.00').length).toBeGreaterThan(0)
  })

  it('a cart failure is toasted and the button comes back', async () => {
    addToCart.mockRejectedValue(new Error('Only 1 left'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Only 1 left', 'error'))
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeEnabled()
  })

  it('variants: lists them, preselects the first, and re-prices on a different choice', () => {
    mount({ variants: [variant('a'), variant('b', { price: 2360 })] })
    expect(screen.getByText('Select Size')).toBeInTheDocument()
    expect(screen.getAllByText('Rs. 1,180.00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Var b' }))
    expect(screen.getAllByText('Rs. 2,360.00').length).toBeGreaterThan(0)
  })

  it('selecting a variant puts its SKU in the URL and view-tracks it once', async () => {
    mount({ variants: [variant('a'), variant('b')] })
    expect(window.location.search).toContain('sku=SKU-a')
    fireEvent.click(screen.getByRole('button', { name: 'Var b' }))
    expect(window.location.search).toContain('sku=SKU-b')
    await waitFor(() => expect(trackViewItem).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SKU-a' })))
  })

  it('opens on the variant named in the sku param', () => {
    mount({ variants: [variant('a'), variant('b', { price: 3000 })], initialSkuParam: 'SKU-b' })
    expect(screen.getAllByText('Rs. 3,000.00').length).toBeGreaterThan(0)
  })

  it('an out-of-stock selection disables both buy buttons', () => {
    mount({ variants: [variant('a', { stock_status: 'Out of Stock' })] })
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeDisabled()
  })

  it('sub-variants appear for the chosen variant, defaulting to the first available', () => {
    const subs = [
      { id: 's1', sub_variant_name: 'Black', sku: 'S-B', price: 1180, mrp: null, price_ex_gst: null, stock_status: 'Out of Stock', is_active: true },
      { id: 's2', sub_variant_name: 'White', sku: 'S-W', price: 1300, mrp: null, price_ex_gst: null, stock_status: 'In Stock', is_active: true },
    ]
    mount({ variants: [variant('a', { sub_variant_type: 'Colour', sub_variants: subs }), variant('b')] })
    expect(screen.getByText('Select Colour')).toBeInTheDocument()
    expect(screen.getAllByText('Rs. 1,300.00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Black/ }))
    expect(screen.getAllByText('Rs. 1,180.00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Var b' }))
    expect(screen.queryByText('Select Colour')).not.toBeInTheDocument()
  })

  it('Buy Now creates a checkout intent and goes to review', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ intent: 'abc 1' }) })
    mount({ variants: [variant('a')] })
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/review?intent=abc%201'))
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('/api/checkout/intents')
    expect(JSON.parse(call[1].body)).toEqual({ productId: 'p1', variantId: 'a', subVariantId: null, qty: 1, buyMode: 'unit', buyUnit: 'unit' })
  })

  it('Buy Now failures are toasted: server message, then network', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Not available' }) })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not available', 'error'))
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not reach the server. Please try again.', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('a full cart line blocks adding and says so', () => {
    cartItems = [{ product_id: 'p1', variant_id: null, sub_variant_id: null, buy_mode: 'unit', quantity: 2 }]
    mount({ productUnits: [{ id: 'u', variant_id: null, sub_variant_id: null, unit: 'unit', factor: 1, is_base: true, is_purchase_default: true, display_label: null, dimension: 'count', max_qty: 2 }] })
    expect(screen.getByRole('button', { name: 'Max quantity already in cart' })).toBeDisabled()
    expect(screen.getByText('2 already in cart')).toBeInTheDocument()
  })

  it('shows "View cart" once the product is in the cart', () => {
    cartItems = [{ product_id: 'p1', variant_id: null, sub_variant_id: null, buy_mode: 'unit', quantity: 1 }]
    mount()
    expect(screen.getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')
  })

  it('digital: Buy Now only; an owner gets an "Open in vault" link instead', () => {
    const a = mount({ digital: true })
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Cart' })).not.toBeInTheDocument()
    a.unmount()
    mount({ digital: true, alreadyOwned: true, vaultUrl: 'https://vault.test/x' })
    expect(screen.getByRole('link', { name: 'Open in vault' })).toHaveAttribute('href', 'https://vault.test/x')
    expect(screen.queryByRole('button', { name: 'Buy Now' })).not.toBeInTheDocument()
  })

  it('a pre-launch product shows "Coming Soon" and cannot be bought; a discontinued one says so', () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString()
    const a = mount({ launchDate: future })
    expect(screen.getByText(/Coming Soon/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled()
    a.unmount()
    mount({ discontinueDate: new Date(Date.now() - 86400000).toISOString() })
    expect(screen.getByText('This product has been discontinued')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeDisabled()
  })

  it('an inactive product cannot be bought', () => {
    mount({ is_active: false })
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled()
  })

  it('mixed pricing modes offer a "Buy by" switch that selects that mode\'s first variant', () => {
    mount({ variants: [variant('a'), variant('b', { pricing_type: 'weight', price: 500, unit: 'kg', numeric_value: 1 })] })
    expect(screen.getByText('Buy by')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'weight' }))
    expect(screen.getByText('Select Weight')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Var b' })).toBeInTheDocument()
  })

  it('long variant lists are collapsed behind a "show more"', () => {
    const many = Array.from({ length: 15 }, (_, i) => variant(`v${i}`))
    mount({ variants: many })
    expect(screen.queryByRole('button', { name: 'Var v14' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 15 options' }))
    expect(screen.getByRole('button', { name: 'Var v14' })).toBeInTheDocument()
  })

  it('passes the subscription flag and the product name to the sticky bar', () => {
    mount({ isSubscription: true })
    expect(screen.getByTestId('subscribe')).toHaveTextContent('true')
    expect(screen.getByTestId('sticky')).toHaveTextContent('Halo Speaker:false')
  })

  it('the signed-in visitor\'s default address pincode drives the delivery estimate request', async () => {
    user = { id: 'u1' }
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ addresses: [{ postal_code: '411001', is_default: true }] }) })
    mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/addresses'))
  })
})

describe('exported parts', () => {
  it('PurchaseNotices renders nothing for an ordinary product', () => {
    const { container } = render(<PurchaseNotices s={{ isPreLaunch: false, isDiscontinued: false } as any} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('PurchaseButtons: buyNow="digital" hides Buy Now for physical goods, viewCart=false hides the cart link, labels apply', () => {
    const s: any = { digital: false, alreadyOwned: false, subscribing: false, is_active: true, effectiveStock: 3, isBuyingNow: false, isAddingToCart: false, isPreLaunch: false, isDiscontinued: false, addBlocked: false, cartCap: { full: false }, inCart: true, handleBuyNow: vi.fn(), handleAddToCart: vi.fn() }
    render(<PurchaseButtons s={s} buyNow="digital" viewCart={false} addLabel="Add it" />)
    expect(screen.queryByRole('button', { name: 'Buy Now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View cart' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    expect(s.handleAddToCart).toHaveBeenCalled()
  })

  it('PurchaseButtons shows nothing while the visitor is choosing a subscription', () => {
    const s: any = { digital: false, alreadyOwned: false, subscribing: true }
    render(<PurchaseButtons s={s} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
