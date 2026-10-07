import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

const push = vi.fn()
const showToast = vi.fn()
const auth: { user: unknown; isLoading: boolean } = { user: { id: 'u1', email: 'a@b.c' }, isLoading: false }
const search = new URLSearchParams('product=p1&interval=monthly&qty=2')

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => search }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/components/visitor/AddressFormModal', () => ({ default: () => null }))

import { SubscribeCheckout } from '@/components/subscriptions/SubscribeCheckout'

const ADDRESS = {
  id: 'a1',
  full_name: 'Asha',
  address_line1: '1 Main St',
  city: 'Chennai',
  state: 'TN',
  postal_code: '600001',
  phone: '9999999999',
  is_default: true,
}
const QUOTE = {
  unitPrice: 400,
  quantity: 2,
  shipping: 50,
  amount: 850,
  interval: 'monthly',
  intervalLabel: 'Monthly',
  isDigital: false,
  collectingAccount: 'platform',
  merchantLabel: 'Jeffi',
}
const CREATED = {
  localId: 's1',
  razorpaySubscriptionId: 'sub_X',
  keyId: 'rzp_test_k',
  amount: 850,
  name: 'Store',
  description: 'Monthly',
  prefill: { name: 'Asha', email: 'a@b.c', contact: '9999999999' },
}

const fetchMock = vi.fn()
let verifyResult: Record<string, unknown> = { localId: 's1', status: 'active', orderId: 'o9', orderNumber: 'ORD-9' }
let rzpOptions: any
const rzpOpen = vi.fn()
const loc = { href: '', hostname: 'localhost', pathname: '/subscribe', search: '?product=p1&interval=monthly&qty=2' }

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body })

beforeEach(() => {
  auth.user = { id: 'u1', email: 'a@b.c' }
  auth.isLoading = false
  loc.href = ''
  rzpOptions = undefined
  fetchMock.mockReset()
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/user/addresses') return json({ addresses: [ADDRESS] })
    if (url === '/api/subscriptions/quote') return json(QUOTE)
    if (url === '/api/subscriptions') return json(CREATED)
    if (url === '/api/subscriptions/verify') return json(verifyResult)
    return json({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'Razorpay',
    class {
      constructor(opts: any) {
        rzpOptions = opts
      }
      on() {}
      open = rzpOpen
    }
  )
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true })
  // Pretend checkout.js is already on the page.
  const s = document.createElement('script')
  s.type = 'text/plain'
  s.src = 'https://checkout.razorpay.com/v1/checkout.js'
  document.body.appendChild(s)
})
afterEach(() => {
  cleanup()
  document.querySelectorAll('script').forEach(s => s.remove())
  vi.unstubAllGlobals()
})

const payButton = () => screen.getByRole('button', { name: /subscribe/i }) as HTMLButtonElement
const calls = (url: string) => fetchMock.mock.calls.filter(c => c[0] === url)

describe('SubscribeCheckout', () => {
  it('redirects anonymous users to login with a return url', () => {
    auth.user = null
    render(<SubscribeCheckout isBusiness={false} />)
    expect(push).toHaveBeenCalledWith(
      `/login?redirect=${encodeURIComponent('/subscribe?product=p1&interval=monthly&qty=2')}`
    )
  })

  it('renders the per-cycle quote for the selected address and discloses the mandate merchant', async () => {
    render(<SubscribeCheckout isBusiness={false} />)
    await waitFor(() => expect(screen.getByTestId('subscribe-summary').textContent).toContain('₹850.00'))
    const body = JSON.parse(calls('/api/subscriptions/quote').at(-1)![1].body)
    expect(body).toMatchObject({ productId: 'p1', interval: 'monthly', quantity: 2, addressId: 'a1' })
    expect(screen.getByText('Jeffi')).toBeTruthy()
    expect(screen.getByText(/₹15,000/)).toBeTruthy()
  })

  it('requires consent before paying', async () => {
    render(<SubscribeCheckout isBusiness={false} />)
    await waitFor(() => expect(screen.getByTestId('subscribe-summary')).toBeTruthy())
    expect(payButton().disabled).toBe(true)
    fireEvent.click(payButton())
    expect(calls('/api/subscriptions')).toHaveLength(0)

    fireEvent.click(screen.getByLabelText('I agree to the auto-debit terms'))
    expect(payButton().disabled).toBe(false)
  })

  it('creates the subscription, opens Razorpay with subscription_id, verifies and redirects to the order', async () => {
    render(<SubscribeCheckout isBusiness={false} />)
    await waitFor(() => expect(screen.getByTestId('subscribe-summary')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('I agree to the auto-debit terms'))
    fireEvent.click(payButton())

    await waitFor(() => expect(rzpOpen).toHaveBeenCalled())
    expect(JSON.parse(calls('/api/subscriptions')[0][1].body)).toMatchObject({
      productId: 'p1',
      interval: 'monthly',
      quantity: 2,
      addressId: 'a1',
      consent: true,
    })
    expect(rzpOptions).toMatchObject({ key: 'rzp_test_k', subscription_id: 'sub_X' })
    expect(rzpOptions.order_id).toBeUndefined()

    const resp = { razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_X', razorpay_signature: 'sig' }
    await act(async () => rzpOptions.handler(resp))
    expect(JSON.parse(calls('/api/subscriptions/verify')[0][1].body)).toEqual(resp)
    expect(loc.href).toBe('/account/orders/o9')
  })

  it('redirects to My subscriptions when verify returns no order yet', async () => {
    verifyResult = { localId: 's1', status: 'authenticated', orderId: null, orderNumber: null }
    render(<SubscribeCheckout isBusiness={false} />)
    await waitFor(() => expect(screen.getByTestId('subscribe-summary')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('I agree to the auto-debit terms'))
    fireEvent.click(payButton())
    await waitFor(() => expect(rzpOpen).toHaveBeenCalled())
    await act(async () =>
      rzpOptions.handler({ razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_X', razorpay_signature: 's' })
    )
    expect(loc.href).toBe('/account/subscriptions')
  })

  it('business portal sends the X-Auth-Portal header', async () => {
    render(<SubscribeCheckout isBusiness />)
    await waitFor(() => expect(calls('/api/subscriptions/quote').length).toBeGreaterThan(0))
    expect(calls('/api/subscriptions/quote')[0][1].headers['X-Auth-Portal']).toBe('business')
  })
})
