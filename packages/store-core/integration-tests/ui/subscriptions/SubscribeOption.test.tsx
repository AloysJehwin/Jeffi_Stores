import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const useAuthMock = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

const flags = { subscriptionsEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import SubscribeOption, { subscribeIntervalsFor, formatInr } from '@/components/subscriptions/SubscribeOption'

const baseProps = {
  productId: 'p1',
  variantId: null,
  subVariantId: null,
  isSubscription: true,
  intervals: ['weekly', 'monthly'] as string[],
  digital: false,
  mode: 'once' as const,
  onModeChange: () => {},
}

describe('subscribeIntervalsFor (pure helper)', () => {
  it('returns [] when the master flag is off', () => {
    expect(subscribeIntervalsFor(false, true, ['weekly'])).toEqual([])
  })
  it('filters out non-subscription intervals', () => {
    expect(subscribeIntervalsFor(true, true, ['weekly', 'bogus', 'yearly'])).toEqual(['weekly', 'yearly'])
  })
})

describe('formatInr', () => {
  it('formats to a two-decimal rupee string', () => {
    expect(formatInr(1234.5)).toBe('₹1,234.50')
  })
})

describe('SubscribeOption (render + branches)', () => {
  beforeEach(() => {
    push.mockReset()
    useAuthMock.mockReturnValue({ user: null })
    flags.subscriptionsEnabled = true
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('renders nothing when no subscription intervals are allowed', () => {
    const { container } = render(<SubscribeOption {...baseProps} intervals={[]} onModeChange={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders both purchase tabs in once mode and hides the subscribe panel', () => {
    render(<SubscribeOption {...baseProps} mode="once" />)
    expect(screen.getByRole('tab', { name: 'One-time purchase' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Subscribe' })).toHaveAttribute('aria-selected', 'false')
    // Subscribe panel only renders in subscribe mode.
    expect(screen.queryByText('Deliver / renew')).not.toBeInTheDocument()
  })

  it('fires onModeChange when the Subscribe tab is clicked', () => {
    const onModeChange = vi.fn()
    render(<SubscribeOption {...baseProps} mode="once" onModeChange={onModeChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    expect(onModeChange).toHaveBeenCalledWith('subscribe')
  })

  it('in subscribe mode renders an interval chip per allowed interval and the sign-in hint when logged out', () => {
    render(<SubscribeOption {...baseProps} mode="subscribe" />)
    expect(screen.getByText('Deliver / renew')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Weekly/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Monthly/ })).toBeInTheDocument()
    expect(screen.getByText(/Sign in to see your subscription price/)).toBeInTheDocument()
  })

  it('selects an interval chip via aria-pressed when clicked', () => {
    render(<SubscribeOption {...baseProps} mode="subscribe" />)
    const weekly = screen.getByRole('button', { name: /Weekly/ })
    const monthly = screen.getByRole('button', { name: /Monthly/ })
    // First allowed interval is pre-selected.
    expect(weekly).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(monthly)
    expect(monthly).toHaveAttribute('aria-pressed', 'true')
    expect(weekly).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the quantity selector for physical goods but not digital', () => {
    const { rerender } = render(<SubscribeOption {...baseProps} mode="subscribe" digital={false} />)
    expect(screen.getByLabelText('Quantity per cycle')).toBeInTheDocument()
    rerender(<SubscribeOption {...baseProps} mode="subscribe" digital={true} />)
    expect(screen.queryByLabelText('Quantity per cycle')).not.toBeInTheDocument()
  })

  it('shows the needs-choice message instead of a price when a variant choice is missing', () => {
    render(<SubscribeOption {...baseProps} mode="subscribe" needsChoice="Pick a size first" />)
    expect(screen.getByText('Pick a size first')).toBeInTheDocument()
  })

  it('navigates to the subscribe flow on Subscribe with the chosen interval and qty', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    render(<SubscribeOption {...baseProps} mode="subscribe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(push).toHaveBeenCalledTimes(1)
    const url = push.mock.calls[0][0] as string
    expect(url).toContain('product=p1')
    expect(url).toContain('interval=weekly')
    expect(url).toContain('/subscribe?')
  })

  it('does not navigate when a variant choice is still required', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    render(<SubscribeOption {...baseProps} mode="subscribe" needsChoice="Pick a size" />)
    const subscribeBtn = screen.getByRole('button', { name: 'Subscribe' })
    expect(subscribeBtn).toBeDisabled()
    fireEvent.click(subscribeBtn)
    expect(push).not.toHaveBeenCalled()
  })
})
