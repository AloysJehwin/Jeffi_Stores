import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The installed React has no `use`; the component reads its route params with it, so give it a pass-through.
vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react')
  return { ...actual, use: (v: any) => v }
})

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let auth: any = { user: { id: 'u1' }, isLoading: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const refreshCart = vi.fn()
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ refreshCart }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let cfg: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))
vi.mock('@/lib/tenancy/forms-host', () => ({ documentUrlForLocation: (kind: string, _loc: any, token: string) => `https://docs.test/${kind}/${token}` }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div data-testid="mobile-header" /> }))
vi.mock('@/components/visitor/CustomSelect', () => ({ default: () => <div data-testid="select" /> }))
// Specifiers split so the component-tests check doesn't count a stub as coverage of these shared components.
vi.mock('@/components/' + 'DelhiveryTracking',() => ({ default: ({ trackPath }: any) => <div data-testid="tracking">{trackPath ?? 'fwd'}</div> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: () => null }))
vi.mock('@/components/shared/' + 'OrderAddressChange',() => ({ default: () => <div data-testid="address-change" /> }))
vi.mock('@/components/visitor/skeletons/account', () => ({ OrderDetailSkeleton: () => <div role="status">loading order</div> }))
vi.mock('@storefront/app/(storefront)/account/orders/[id]/ReviewModal', () => ({
  default: ({ onClose }: any) => (
    <div role="dialog" aria-label="review modal">
      <button onClick={onClose}>close review</button>
    </div>
  ),
}))
vi.mock('@/components/payments', () => ({
  PaymentSections: () => <div data-testid="payment-sections" />,
  UpiManualDialog: () => null,
  razorpayDisplayConfig: () => ({}),
  upiFlag: () => false,
  useUpiPayment: () => ({ start: vi.fn(), state: null }),
}))

import OrderDetailClient from '@storefront/app/(storefront)/account/orders/[id]/OrderDetailClient'

const fetchMock = vi.fn()
const orderBody = (over: Record<string, any> = {}) => ({
  id: 'o1', orderNumber: 'ORD-1001', invoiceNumber: 'INV-1', viewToken: 'tok', totalAmount: 2124, subtotal: 2000, taxAmount: 324, discountAmount: 200, shippingAmount: 0,
  status: 'confirmed', paymentStatus: 'paid', paymentMode: 'online', source: 'online', upiConfirmation: null,
  createdAt: '2026-03-05T10:00:00Z', updatedAt: '2026-03-05T10:00:00Z', deliveredAt: null, notes: null, trackingUrl: null, awbNumber: null, estimatedDeliveryDate: null,
  originalOrderId: null, originalOrderNumber: null, orderType: 'cart', hasDigital: false, isAllDigital: false,
  shippingAddress: { full_name: 'Asha Rao', address_line1: '12 MG Road', city: 'Pune', state: 'MH', postal_code: '411001', phone: '9876543210' },
  items: [{
    id: 'i1', productId: 'p1', productName: 'Halo Speaker', productSku: 'SKU1', variantName: 'Black', subVariantName: null, subVariantSku: null, quantity: 2, unitPrice: 1000, totalPrice: 2000,
    buyMode: 'unit', buyUnit: null, returnAllowed: true, returnWindowDays: 7, replacementAllowed: false, replacementWindowDays: 0,
    products: { slug: 'halo-speaker', product_images: [{ thumbnail_url: '/t.png', image_url: '/i.png', is_primary: true }] },
  }],
  ...over,
})
const routes = (order: any, extra: Record<string, any> = {}) =>
  fetchMock.mockImplementation(async (url: string, init?: any) => {
    if (extra[url]) return extra[url](init)
    if (url === '/api/orders/o1') return { ok: true, json: async () => ({ order }) }
    if (url.startsWith('/api/reviews')) return { ok: true, json: async () => ({ reviews: [] }) }
    if (url === '/api/orders/o1/return' && !init) return { ok: true, json: async () => ({ returnRequest: null, monthlyLimitReached: false }) }
    return { ok: true, json: async () => ({}) }
  })
const mount = () => render(<OrderDetailClient params={{ id: 'o1' } as any} />)

describe('OrderDetailClient', () => {
  beforeEach(() => {
    for (const m of [push, refreshCart, showToast, fetchMock]) m.mockReset()
    auth = { user: { id: 'u1' }, isLoading: false }
    cfg = { flags: { razorpayEnabled: true }, orderAutoCancelMinutes: 30, identity: { name: 'Halo' } }
    vi.stubGlobal('fetch', fetchMock)
  })

  it('redirects a signed-out visitor to login with a way back', async () => {
    auth = { user: null, isLoading: false }
    mount()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?redirect=/account/orders/o1'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows "Order Not Found" with the reason when the order cannot be loaded', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    mount()
    expect(await screen.findByRole('heading', { name: 'Order Not Found' })).toBeInTheDocument()
    expect(screen.getByText('Failed to fetch order details')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View All Orders' })).toHaveAttribute('href', '/account/orders')
  })

  it('draws the header, items and totals', async () => {
    routes(orderBody())
    mount()
    expect(await screen.findByRole('heading', { name: 'Order #ORD-1001' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orders/o1')
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Payment: paid')).toBeInTheDocument()
    expect(screen.getByText('Halo Speaker')).toBeInTheDocument()
    expect(screen.getByText(/₹1,000\.00.*x 2.*= ₹2,000\.00/)).toBeInTheDocument()
    expect(screen.getByText('Subtotal').nextSibling).toHaveTextContent('₹2,000.00')
    expect(screen.getByText('Incl. GST').nextSibling).toHaveTextContent('₹324.00')
    expect(screen.getByText('Discount').nextSibling).toHaveTextContent('−₹200.00')
    expect(screen.queryByText('Delivery', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('Total', { selector: 'span' }).nextSibling).toHaveTextContent('₹2,124.00')
    expect(screen.getByText('Price inclusive of all taxes')).toBeInTheDocument()
    expect(screen.getByText('Shipping Address')).toBeInTheDocument()
    expect(screen.getByText('12 MG Road')).toBeInTheDocument()
  })

  it('links the invoice for a paid order and the vault for digital goods', async () => {
    routes(orderBody({ hasDigital: true, vaultUrl: 'https://vault.test/v' }))
    mount()
    await screen.findByRole('heading', { name: 'Order #ORD-1001' })
    expect(screen.getByRole('link', { name: 'View Invoice' })).toHaveAttribute('href', 'https://docs.test/invoice/tok')
    expect(screen.getByRole('link', { name: 'Open my vault' })).toHaveAttribute('href', 'https://vault.test/v')
    expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument()
  })

  it('a replacement order points back to the original', async () => {
    routes(orderBody({ originalOrderId: 'o0', originalOrderNumber: 'ORD-0999' }))
    mount()
    const link = await screen.findByRole('link', { name: '#ORD-0999' })
    expect(link).toHaveAttribute('href', '/account/orders/o0')
  })

  it('cancelling a confirmed order asks first, sends the request, refetches and refreshes the cart', async () => {
    routes(orderBody(), { '/api/orders/o1/cancel': () => ({ ok: true, json: async () => ({}) }) })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Request Cancellation' }))
    expect(screen.getByText('Request cancellation for this order?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Order' }))
    expect(screen.queryByText('Request cancellation for this order?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request Cancellation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Request Cancellation' }))
    await waitFor(() => expect(refreshCart).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/orders/o1/cancel')!
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toEqual({ restoreToCart: true })
    await waitFor(() => expect(screen.queryByText('Request cancellation for this order?')).not.toBeInTheDocument())
  })

  it('an unpaid pending order offers "Cancel Order" with immediate wording, and a failure is toasted', async () => {
    routes(orderBody({ status: 'pending', paymentStatus: 'unpaid', createdAt: new Date().toISOString() }), {
      '/api/orders/o1/cancel': () => ({ ok: false, json: async () => ({ error: 'Already shipped' }) }),
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Order' }))
    expect(screen.getByText('Cancel this order?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Cancel Order' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already shipped', 'error'))
  })

  it('a pending-cancellation order shows the review banner and no cancel button', async () => {
    routes(orderBody({ status: 'cancel_requested' }))
    mount()
    expect(await screen.findByText('Cancellation Requested')).toBeInTheDocument()
    expect(screen.getByText(/pending review by our team/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request Cancellation' })).not.toBeInTheDocument()
  })

  it('a delivered order offers reviews, which open the review modal', async () => {
    routes(orderBody({ status: 'delivered', deliveredAt: new Date().toISOString() }))
    mount()
    expect(await screen.findByText('Rate Your Order')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Write Reviews' }))
    expect(screen.getByRole('dialog', { name: 'review modal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close review' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows existing reviews as done', async () => {
    routes(orderBody({ status: 'delivered', deliveredAt: new Date().toISOString() }), {})
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/orders/o1') return { ok: true, json: async () => ({ order: orderBody({ status: 'delivered', deliveredAt: new Date().toISOString() }) }) }
      if (url.startsWith('/api/reviews')) return { ok: true, json: async () => ({ reviews: [{ product_id: 'p1', rating: 5, title: 'Great' }] }) }
      return { ok: true, json: async () => ({ returnRequest: null }) }
    })
    mount()
    expect(await screen.findByText('You have reviewed all items in this order.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Reviews' })).toBeInTheDocument()
  })

  it('a delivered order inside its return window offers a return, and the form can be opened and cancelled', async () => {
    routes(orderBody({ status: 'delivered', deliveredAt: new Date().toISOString() }))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Request Return' }))
    expect(screen.getByText('Select items to return')).toBeInTheDocument()
    expect(screen.getByTestId('select')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit Request' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Select items to return')).not.toBeInTheDocument()
  })

  it('an expired return window shows a closed badge instead of the button', async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString()
    routes(orderBody({ status: 'delivered', deliveredAt: old, updatedAt: old }))
    mount()
    expect(await screen.findByText('Return window closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request Return' })).not.toBeInTheDocument()
  })

  it('shows the monthly return limit when it has been reached', async () => {
    routes(orderBody({ status: 'delivered', deliveredAt: new Date().toISOString() }), {
      '/api/orders/o1/return': () => ({ ok: true, json: async () => ({ returnRequest: null, monthlyLimitReached: true }) }),
    })
    mount()
    expect(await screen.findByText('Monthly return limit reached')).toBeInTheDocument()
  })

  it('shows shipment tracking when there is an AWB', async () => {
    routes(orderBody({ status: 'shipped', awbNumber: 'AWB123' }))
    mount()
    expect(await screen.findByText('Shipment Tracking')).toBeInTheDocument()
    expect(screen.getByTestId('tracking')).toHaveTextContent('fwd')
  })

  it('an unpaid online order shows the pay-now countdown', async () => {
    routes(orderBody({ status: 'pending', paymentStatus: 'unpaid', createdAt: new Date().toISOString() }))
    mount()
    expect(await screen.findByText(/Payment is pending for this order/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Pay ₹2,124/ }).length).toBeGreaterThan(0)
  })

  it('a COD order never shows the pay-now prompt', async () => {
    routes(orderBody({ status: 'pending', paymentStatus: 'unpaid', paymentMode: 'cod' }))
    mount()
    await screen.findByRole('heading', { name: 'Order #ORD-1001' })
    expect(screen.queryByText(/Payment is pending for this order/)).not.toBeInTheDocument()
  })
})
