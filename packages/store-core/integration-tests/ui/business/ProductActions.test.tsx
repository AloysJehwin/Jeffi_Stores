import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const router = { push }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
const addToCart = vi.fn<(...a: any[]) => Promise<void>>()
const cart: { cartItems: any[] } = { cartItems: [] }
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart, cartItems: cart.cartItems }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const auth: { user: any } = { user: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const flags = { gstEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
const resolveEdd = vi.fn<(...a: any[]) => Promise<string | null>>()
vi.mock('@/lib/shipping/edd-cache', () => ({ resolveEdd: (...a: any[]) => resolveEdd(...a) }))
vi.mock('@/components/shared/QuantityInput', () => ({
  default: ({ quantity, onChange, qtyMin, qtyMax }: any) => (
    <input aria-label="qty" type="number" value={quantity} data-min={qtyMin} data-max={qtyMax ?? ''} onChange={e => onChange(Number(e.target.value), e.target.value)} />
  ),
}))
vi.mock('@/components/subscriptions/SubscribeOption', () => ({
  default: ({ mode, onModeChange, needsChoice }: any) => (
    <div>
      <button onClick={() => onModeChange(mode === 'once' ? 'subscribe' : 'once')}>toggle-subscribe</button>
      {needsChoice && <span>{needsChoice}</span>}
    </div>
  ),
}))

import ProductActions from '@/components/business/ProductActions'

const variant = (over: Record<string, any> = {}) => ({
  id: 'v1',
  variant_name: 'Black',
  sku: 'H-BLK',
  price: 1000,
  mrp: 1250,
  mrp_ex_gst: null,
  price_ex_gst: null,
  stock_status: 'In Stock',
  ...over,
})
const base = (over: Record<string, any> = {}): any => ({
  productId: 'p1',
  productName: 'Halo Headphones',
  sku: 'HALO-1',
  stockStatus: 'In Stock',
  basePrice: 1000,
  salePrice: null,
  mrp: 1250,
  gstPercentage: 18,
  variants: [],
  variantType: 'Colour',
  ...over,
})

describe('business ProductActions', () => {
  beforeEach(() => {
    push.mockClear()
    addToCart.mockResolvedValue(undefined)
    cart.cartItems = []
    auth.user = null
    flags.gstEnabled = true
    resolveEdd.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
  })

  it('shows price, MRP strike-through, savings, GST note and stock for a simple product', () => {
    render(<ProductActions {...base()} isCodAllowed />)
    expect(screen.getByText(/Rs\.\s*1,000\.00/, { selector: 'span.text-4xl' })).toBeInTheDocument()
    expect(screen.getByText(/1,250\.00/, { selector: 'span.line-through' })).toBeInTheDocument()
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText(/You save Rs\.\s*250\.00/)).toBeInTheDocument()
    expect(screen.getByText('Inclusive of all taxes (18% GST)')).toBeInTheDocument()
    expect(screen.getByText('In Stock')).toBeInTheDocument()
    expect(screen.getByText('COD')).toBeInTheDocument()
  })

  it('recomputes the total when the quantity changes', () => {
    render(<ProductActions {...base()} />)
    fireEvent.change(screen.getByLabelText('qty'), { target: { value: '3' } })
    expect(screen.getByText(/Total \(3/)).toBeInTheDocument()
    expect(screen.getByText(/Rs\.\s*3,000\.00/, { selector: 'span.font-semibold' })).toBeInTheDocument()
  })

  it('applies an approved business buyer category discount and explains it', () => {
    auth.user = { isBusiness: true, approvalStatus: 'approved', businessDiscountMap: { c1: 10 } }
    render(<ProductActions {...base({ categoryId: 'c1' })} />)
    expect(screen.getByText(/Rs\.\s*900\.00/, { selector: 'span.text-4xl' })).toBeInTheDocument()
    expect(screen.getByText(/business discount/)).toBeInTheDocument()
  })

  it('applies a product discount on top of the MRP', () => {
    render(<ProductActions {...base({ discountPct: 10, mrp: 2000, basePrice: 2000 })} />)
    expect(screen.getByText(/Rs\.\s*1,800\.00/, { selector: 'span.text-4xl' })).toBeInTheDocument()
  })

  it('drops the tax note and uses the ex-GST price when GST is off', () => {
    flags.gstEnabled = false
    render(<ProductActions {...base({ basePriceExGst: 847.46 })} />)
    expect(screen.getByText(/Rs\.\s*847\.46/, { selector: 'span.text-4xl' })).toBeInTheDocument()
    expect(screen.queryByText(/Inclusive of all taxes/)).toBeNull()
  })

  it('adds to the cart with the chosen quantity and confirms', async () => {
    render(<ProductActions {...base()} />)
    fireEvent.change(screen.getByLabelText('qty'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item added to cart!', 'success'))
    expect(addToCart).toHaveBeenCalledWith('p1', 2, undefined, 'unit', 'unit', undefined)
  })

  it('shows the error when adding to the cart fails', async () => {
    addToCart.mockRejectedValue(new Error('Out of stock now'))
    render(<ProductActions {...base()} />)
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Out of stock now', 'error'))
  })

  it('blocks adding when the per-unit cap is already in the cart', () => {
    cart.cartItems = [{ product_id: 'p1', variant_id: null, sub_variant_id: null, buy_mode: 'unit', quantity: 5 }]
    render(
      <ProductActions
        {...base({ productUnits: [{ id: 'u1', variant_id: null, sub_variant_id: null, unit: 'unit', factor: 1, is_base: true, is_purchase_default: true, display_label: null, dimension: 'count', max_qty: 5 }] })}
      />
    )
    expect(screen.getByRole('button', { name: 'Max quantity already in cart' })).toBeDisabled()
  })

  it('starts Buy Now through a checkout intent and goes to review', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ intent: 'int 1' })))
    render(<ProductActions {...base()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/business/checkout/review?intent=int%201'))
    const call = vi.mocked(fetch).mock.calls.find(c => c[0] === '/api/checkout/intents')!
    expect(call[1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'X-Auth-Portal': 'business' }) })
    expect(JSON.parse((call[1] as any).body)).toMatchObject({ productId: 'p1', qty: 1, variantId: null })
  })

  it('shows why Buy Now could not start, or that the server is unreachable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Cart locked' }), { status: 409 }))
    render(<ProductActions {...base()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cart locked', 'error'))
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not reach the server. Please try again.', 'error'))
    expect(push).not.toHaveBeenCalled()
  })

  it('disables purchasing when sold out or inactive', () => {
    const { unmount } = render(<ProductActions {...base({ stockStatus: 'Out of Stock' })} />)
    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeDisabled()
    unmount()
    render(<ProductActions {...base({ is_active: false })} />)
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeDisabled()
  })

  it('offers Buy Now only, with no quantity box, for digital products', () => {
    render(<ProductActions {...base({ digital: true })} />)
    expect(screen.queryByLabelText('qty')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add to Cart/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeInTheDocument()
  })

  it('hides the buy buttons while subscribing', () => {
    render(<ProductActions {...base({ isSubscription: true })} />)
    fireEvent.click(screen.getByText('toggle-subscribe'))
    expect(screen.queryByRole('button', { name: 'Buy Now' })).toBeNull()
  })

  it('lists variants, selects one, reports the choice and prices off it', () => {
    const onVariantChange = vi.fn()
    const onSelectionChange = vi.fn()
    const variants = [variant(), variant({ id: 'v2', variant_name: 'White', sku: 'H-WHT', price: 1100, mrp: null }), variant({ id: 'v3', variant_name: 'Red', sku: 'H-RED', stock_status: 'Out of Stock' })]
    render(<ProductActions {...base({ variants, onVariantChange, onSelectionChange })} />)
    expect(screen.getByText('Select Colour')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Red (Out of Stock)' })).toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith('v1', null)
    fireEvent.click(screen.getByRole('button', { name: 'White' }))
    expect(onVariantChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'v2' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith('v2', null)
    expect(screen.getByText(/Rs\.\s*1,100\.00/, { selector: 'span.text-4xl' })).toBeInTheDocument()
    expect(window.location.search).toContain('sku=H-WHT')
  })

  it('disables purchase when the chosen variant is out of stock', () => {
    render(<ProductActions {...base({ variants: [variant({ stock_status: 'Out of Stock' })] })} />)
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeDisabled()
  })

  it('starts on the variant named in the url and keeps sub-variants selectable', () => {
    const variants = [
      variant({ sub_variant_type: 'Size', sub_variants: [{ id: 's1', sub_variant_name: 'S', sku: 'H-S', price: 900, mrp: null, price_ex_gst: null, stock_status: 'In Stock', is_active: true }, { id: 's2', sub_variant_name: 'L', sku: 'H-L', price: 950, mrp: null, price_ex_gst: null, stock_status: 'In Stock', is_active: true }] }),
    ]
    const onSelectionChange = vi.fn()
    render(<ProductActions {...base({ variants, initialSkuParam: 'H-L', onSelectionChange })} />)
    expect(screen.getByText('Select Size')).toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenLastCalledWith('v1', 's2')
    expect(screen.getByText(/Rs\.\s*950\.00/, { selector: 'span.text-4xl' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'S' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith('v1', 's1')
  })

  it('collapses a long variant list behind a Show all control', () => {
    const variants = Array.from({ length: 14 }, (_, i) => variant({ id: `v${i}`, variant_name: `Option ${i}`, sku: `S${i}` }))
    render(<ProductActions {...base({ variants })} />)
    expect(screen.queryByRole('button', { name: 'Option 13' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 14 options' }))
    expect(screen.getByRole('button', { name: 'Option 13' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByRole('button', { name: 'Option 13' })).toBeNull()
  })

  it('reports the sell unit and shows a pack price when the unit is a pack', () => {
    const onUnitChange = vi.fn()
    render(
      <ProductActions
        {...base({
          onUnitChange,
          productUnits: [{ id: 'u1', variant_id: null, sub_variant_id: null, unit: 'box', factor: 6, is_base: true, is_purchase_default: true, display_label: 'Box of 6', dimension: 'count' }],
        })}
      />
    )
    expect(onUnitChange).toHaveBeenLastCalledWith('box', 'Box of 6', expect.objectContaining({ factor: 6, min: 1, dimension: 'count' }))
    expect(screen.getAllByText(/6,000\.00/).length).toBeGreaterThan(0)
  })

  it('enforces the minimum order quantity', () => {
    render(<ProductActions {...base({ moq: 10 })} />)
    expect(screen.getByLabelText('qty')).toHaveAttribute('data-min', '10')
    expect(screen.getByText(/Minimum order: 10/)).toBeInTheDocument()
  })

  it('shows the delivery date for guests, and lets a signed-in buyer pick another saved address', async () => {
    resolveEdd.mockResolvedValue('2026-03-14')
    const guest = render(<ProductActions {...base()} />)
    expect(await screen.findByText('14 Mar')).toBeInTheDocument()
    guest.unmount()

    auth.user = { id: 'u1' }
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).startsWith('/api/user/addresses')) {
        return new Response(JSON.stringify({ addresses: [{ full_name: 'Home', city: 'Chennai', state: 'TN', postal_code: '600001', is_default: true }, { full_name: 'Office', city: 'Pune', state: 'MH', postal_code: '411001' }] }))
      }
      if (String(url).startsWith('/api/products/edd')) return new Response(JSON.stringify({ edd: '2026-03-20' }))
      return new Response('{}', { status: 404 })
    })
    render(<ProductActions {...base({ handlingDays: 3, extraDeliveryDays: 2 })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }))
    expect(screen.getByText('600001', { selector: 'span.font-medium' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Office'))
    expect(await screen.findByText('20 Mar')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]) === '/api/products/edd?pin=411001&handlingDays=3&extraDays=2')).toBe(true)
  })
})
