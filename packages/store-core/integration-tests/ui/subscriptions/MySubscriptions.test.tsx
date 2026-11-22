import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const useAuthMock = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))

// Header + skeleton are unrelated chrome; stub to keep the render focused on the list.
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => <div data-testid="hdr-v" /> }))
vi.mock('@/components/business/AccountMobileHeader', () => ({ default: () => <div data-testid="hdr-b" /> }))
vi.mock('@/components/visitor/skeletons/account', () => ({
  SubscriptionCardSkeleton: () => <div data-testid="sub-skel" />,
}))

import { MySubscriptions, type SubscriptionItem } from '@/components/subscriptions/MySubscriptions'

const sub = (over: Partial<SubscriptionItem> = {}): SubscriptionItem => ({
  id: 's1',
  status: 'active',
  statusLabel: 'Active',
  productId: 'p1',
  productName: 'Coffee Beans',
  productSlug: 'coffee-beans',
  imageUrl: null,
  isDigital: false,
  interval: 'monthly',
  intervalLabel: 'Monthly',
  quantity: 2,
  amount: 499,
  currentCycle: 1,
  totalCycles: null,
  minCycles: null,
  currentEnd: '2026-12-01',
  nextChargeAt: '2026-12-01',
  cancelAtCycleEnd: false,
  accessExpiresAt: null,
  address: null,
  orders: [],
  ...over,
})

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

describe('MySubscriptions (render + branches)', () => {
  beforeEach(() => {
    push.mockReset()
    showToast.mockReset()
    confirm.mockReset()
  })

  it('renders nothing while auth is loading', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { container } = render(<MySubscriptions isBusiness={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('redirects a logged-out visitor to the login route', () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<MySubscriptions isBusiness={false} />)
    expect(push).toHaveBeenCalledWith('/login?redirect=/account/subscriptions')
  })

  it('shows the empty state with a browse link when there are no subscriptions', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ subscriptions: [] })))
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByText('You have no subscriptions yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse products' })).toHaveAttribute('href', '/')
  })

  it('renders a subscription card with price, interval, qty and actions', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ subscriptions: [sub()] })))
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByText('Coffee Beans')).toBeInTheDocument()
    // amount · intervalLabel · Qty, all in one line.
    expect(screen.getByText(/₹499\.00 · Monthly · Qty 2/)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    // active + not cancelling -> pause + cancel available.
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('shows a Resume button for a paused subscription and no Pause', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ subscriptions: [sub({ status: 'paused', statusLabel: 'Paused' })] })))
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it('shows "Retry payment" for a halted PhonePe subscription', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okJson({ subscriptions: [sub({ status: 'halted', statusLabel: 'Halted', billingProvider: 'phonepe' })] }))
    )
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByRole('button', { name: 'Retry payment' })).toBeInTheDocument()
  })

  it('shows the commitment note and disables actions under a minimum-cycle lock', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okJson({ subscriptions: [sub({ minCycles: 3, currentCycle: 1 })] }))
    )
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByTestId('subscription-commitment')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('hides all actions for an ended (cancelled) subscription', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okJson({ subscriptions: [sub({ status: 'cancelled', statusLabel: 'Cancelled' })] }))
    )
    render(<MySubscriptions isBusiness={false} />)
    await screen.findByText('Coffee Beans')
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('renders the digital access line and no quantity for a digital subscription', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okJson({ subscriptions: [sub({ isDigital: true, accessExpiresAt: '2026-12-15' })] }))
    )
    render(<MySubscriptions isBusiness={false} />)
    expect(await screen.findByText(/Access until/)).toBeInTheDocument()
    // Digital -> no "Change address" action.
    expect(screen.queryByRole('button', { name: 'Change address' })).not.toBeInTheDocument()
  })

  it('uses the business header when isBusiness is true', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false })
    vi.stubGlobal('fetch', vi.fn(() => okJson({ subscriptions: [] })))
    render(<MySubscriptions isBusiness={true} />)
    await waitFor(() => expect(screen.getByTestId('hdr-b')).toBeInTheDocument())
    expect(screen.queryByTestId('hdr-v')).not.toBeInTheDocument()
  })
})
