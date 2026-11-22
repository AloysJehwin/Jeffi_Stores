import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const push = vi.fn()
const searchGet = vi.fn<(k: string) => string | null>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: searchGet }),
}))

const useAuthMock = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: {} }) }))

// Payment chrome + address modal are separate components; stub them out.
vi.mock('@/components/payments', () => ({
  PaymentSections: () => <div data-testid="pay-sections" />,
  otherDisplayConfig: () => ({}),
  upiFlag: () => false,
}))
vi.mock('@/components/visitor/AddressFormModal', () => ({ default: () => <div data-testid="addr-modal" /> }))
vi.mock('@/components/visitor/skeletons/commerce', () => ({
  SubscribeSkeleton: () => <div data-testid="subscribe-skel" />,
  SubscribeAddressesSkeleton: () => <div data-testid="addr-skel" />,
  SubscribeQuoteSkeleton: () => <div data-testid="quote-skel" />,
}))

import { SubscribeCheckout } from '@/components/subscriptions/SubscribeCheckout'

const params = (map: Record<string, string>) => searchGet.mockImplementation(k => map[k] ?? null)

describe('SubscribeCheckout (render + branches)', () => {
  beforeEach(() => {
    push.mockReset()
    searchGet.mockReset()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('shows the loading skeleton while auth is resolving', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true })
    params({})
    render(<SubscribeCheckout isBusiness={false} />)
    expect(screen.getByTestId('subscribe-skel')).toBeInTheDocument()
  })

  it('renders nothing once resolved with no user', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false })
    params({})
    const { container } = render(<SubscribeCheckout isBusiness={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the empty guard when product/interval params are missing', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    params({})
    render(<SubscribeCheckout isBusiness={false} />)
    expect(screen.getByText('Nothing to subscribe to.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/')
  })

  it('renders the checkout form heading and quote skeleton while the quote loads', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    params({ product: 'p1', interval: 'monthly', qty: '2' })
    render(<SubscribeCheckout isBusiness={false} />)
    expect(screen.getByRole('heading', { name: 'Start your subscription' })).toBeInTheDocument()
    // Address + quote are still pending (fetch never resolves) -> skeletons.
    expect(screen.getByTestId('quote-skel')).toBeInTheDocument()
    expect(screen.getByLabelText('I agree to the auto-debit terms')).toBeInTheDocument()
  })

  it('renders the priced summary once the quote fetch resolves', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    params({ product: 'p1', interval: 'monthly', qty: '1' })
    const quote = {
      productName: 'Coffee Beans',
      unitPrice: 499,
      interval: 'monthly',
      quantity: 1,
      shipping: 0,
      amount: 499,
      intervalLabel: 'Monthly',
      isDigital: true,
      collectingAccount: 'platform',
      merchantLabel: 'Jeffi',
    }
    // addresses call + quote call both return ok; happy-dom resolves in order.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(String(url).includes('/quote') ? quote : { addresses: [] }),
        } as Response)
      )
    )
    render(<SubscribeCheckout isBusiness={false} />)
    expect(await screen.findByTestId('subscribe-summary')).toBeInTheDocument()
    expect(screen.getByText('Coffee Beans')).toBeInTheDocument()
    // Pay button carries the formatted cycle amount.
    expect(screen.getByRole('button', { name: /Pay ₹499\.00 & subscribe/ })).toBeInTheDocument()
  })
})
