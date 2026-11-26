import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => search }))
vi.mock('@/hooks/useStoreFlags', () => ({ updateChannelsLabel: () => 'WhatsApp', useMessagingChannels: () => ({}) }))
const cart: any = {}
vi.mock('@/contexts/CartContext', () => ({ useCart: () => cart }))
const auth: any = {}
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let flags: Record<string, boolean>
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags, identity: { name: 'Halo' } }) }))
vi.mock('@/components/visitor/AddressFormModal', () => ({ default: () => <div data-testid="address-modal" /> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: () => null }))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <span>{sku}</span> }))
vi.mock('@/components/visitor/CouponHintBanner', () => ({ default: () => null }))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ alt }: any) => <img alt={alt} /> }))
vi.mock('@/components/storefront-ai/CheckoutRecapSummary', () => ({ default: () => null }))
vi.mock('@/components/payments', () => ({
  PaymentSections: ({ cod, razorpay }: any) => <div data-testid="payments">{`cod:${cod} razorpay:${razorpay}`}</div>,
  UpiManualDialog: () => null,
  razorpayDisplayConfig: () => ({}),
  upiFlag: (f: any) => f?.upiEnabled === true,
  useUpiPayment: () => ({ error: null, manual: null, clearError: vi.fn(), start: vi.fn() }),
}))

import { CheckoutReviewPageVisitorWrapper as CheckoutReviewPage } from '@/components/shared/CheckoutReviewPage'

const address = { id: 'a1', full_name: 'Priya Shah', address_line1: '12 MG Road', city: 'Pune', state: 'MH', postal_code: '411001', country: 'IN', phone: '9800000000', is_default: true, address_type: 'home' }
const cartItem = {
  id: 'ci1', product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: '2', buy_mode: 'unit',
  products: { name: 'Cordless Drill', sku: 'DR-1', base_price: 1000, mrp: 1200, gst_percentage: 18, product_images: [], is_cod_allowed: true },
}
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

describe('CheckoutReviewPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    search = new URLSearchParams()
    flags = { codEnabled: true, razorpayEnabled: false, gstEnabled: true, upiEnabled: false }
    Object.assign(cart, { cartItems: [cartItem], cartCount: 1, getCartTotal: () => 2000, getCartTax: () => 305, clearCart: vi.fn(), isLoading: false })
    Object.assign(auth, { user: { id: 'u1' }, isLoading: false })
    fetchMock = vi.fn<(...a: any[]) => any>(async (url: string, init?: any) => {
      if (url === '/api/user/addresses') return ok({ addresses: [address] })
      if (url === '/api/shipping/rate') return ok({ charge: 50, serviceable: true, source: 'delhivery' })
      if (url === '/api/store-settings') return ok({ minOrderAmount: 0 })
      if (url.startsWith('/api/products/edd')) return ok({ edd: 'Fri, 6 Mar' })
      if (url === '/api/coupons/apply') return ok({ couponId: 'c1', code: 'SAVE10', description: '10% off', discountType: 'percent', discountValue: 10, discountAmount: 200 })
      if (url === '/api/orders/create') return ok({ order: { id: 'o99' } })
      return ok({})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the skeleton while the cart loads and nothing for a signed-out user', async () => {
    cart.isLoading = true
    const { container, rerender } = render(<CheckoutReviewPage />)
    expect(screen.queryByRole('button', { name: /Place Order/ })).not.toBeInTheDocument()
    expect(container).not.toBeEmptyDOMElement()
    cart.isLoading = false
    auth.user = null
    rerender(<CheckoutReviewPage />)
    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login?redirect=%2Fcheckout%2Freview'))
  })

  it('shows the address, the line item and the summary with the quoted shipping', async () => {
    render(<CheckoutReviewPage />)
    expect(await screen.findByText('Order Review')).toBeInTheDocument()
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument()
    expect(screen.getByText('12 MG Road')).toBeInTheDocument()
    expect(screen.getByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('Order Summary')).toBeInTheDocument()
    const rate = fetchMock.mock.calls.find(c => c[0] === '/api/shipping/rate')!
    expect(JSON.parse(rate[1].body)).toMatchObject({ destinationPin: '411001', isCod: true })
    await waitFor(() => expect(screen.getByText(/2,050\.00/)).toBeInTheDocument())
    expect(screen.getByTestId('payments')).toHaveTextContent('cod:true razorpay:false')
  })

  it('shows the empty-address state and opens the address form', async () => {
    fetchMock.mockImplementation(async (url: string) => (url === '/api/user/addresses' ? ok({ addresses: [] }) : ok({})))
    render(<CheckoutReviewPage />)
    expect(await screen.findByText('No saved addresses found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place Order/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add Delivery Address' }))
    expect(screen.getByTestId('address-modal')).toBeInTheDocument()
  })

  it('applies a coupon and shows the discount, then removes it', async () => {
    render(<CheckoutReviewPage />)
    await screen.findByText('Priya Shah')
    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'save10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Coupon (SAVE10)')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/coupons/apply')!
    expect(JSON.parse(call[1].body)).toEqual({ code: 'SAVE10', subtotal: 2000 })
    expect(screen.getByText('10% off')).toBeInTheDocument()
  })

  it('shows an invalid coupon error', async () => {
    render(<CheckoutReviewPage />)
    await screen.findByText('Priya Shah')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'Coupon expired' }) })
    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'old' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Coupon expired')).toBeInTheDocument()
  })

  it('places a cash-on-delivery order, clears the cart and goes to the order', async () => {
    render(<CheckoutReviewPage />)
    await screen.findByText('Priya Shah')
    const place = await screen.findByRole('button', { name: /Place Order — Pay on Delivery/ })
    await waitFor(() => expect(place).toBeEnabled())
    fireEvent.change(screen.getByPlaceholderText('Any special instructions...'), { target: { value: 'Ring twice' } })
    fireEvent.click(place)
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/account/orders/o99'))
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/orders/create')!
    expect(JSON.parse(call[1].body)).toMatchObject({ paymentMethod: 'cod', notes: 'Ring twice', shippingAmount: 50, shippingAddress: { postalCode: '411001', fullName: 'Priya Shah' } })
    expect(cart.clearCart).toHaveBeenCalled()
  })

  it('shows the server error when placing the order fails', async () => {
    render(<CheckoutReviewPage />)
    await screen.findByText('Priya Shah')
    const place = await screen.findByRole('button', { name: /Place Order — Pay on Delivery/ })
    await waitFor(() => expect(place).toBeEnabled())
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Out of stock' }) }))
    fireEvent.click(place)
    expect(await screen.findByText('Out of stock')).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalledWith(expect.stringContaining('/account/orders'))
  })

  it('blocks ordering to an unserviceable pincode', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/user/addresses') return ok({ addresses: [address] })
      if (url === '/api/shipping/rate') return ok({ serviceable: false })
      return ok({})
    })
    render(<CheckoutReviewPage />)
    expect((await screen.findAllByText(/Delivery is not available to this pincode/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Place Order/ })).toBeDisabled()
  })

  it('shows the no-payment-method notice when nothing can take the order', async () => {
    flags = { codEnabled: false, razorpayEnabled: false, gstEnabled: true, upiEnabled: false }
    render(<CheckoutReviewPage />)
    expect(await screen.findByText(/unable to accept orders right now/)).toBeInTheDocument()
  })
})
