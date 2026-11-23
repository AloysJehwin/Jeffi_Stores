import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const useAuthMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

vi.mock('@/components/visitor/coupons/terms', () => ({
  cartCouponHref: (code: string) => `/cart?coupon=${code}`,
}))

import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'

const coupon = (over: Record<string, any> = {}) => ({
  id: 'c1',
  code: 'SAVE10',
  description: 'For leaving a review',
  discount_type: 'percentage',
  discount_value: 10,
  valid_until: null,
  ...over,
})

function mockFetch(payload: any) {
  global.fetch = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ json: () => Promise.resolve(payload) })) as any
}

describe('ReviewCouponPopup (render + branches)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    mockFetch({ coupon: null })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when logged out (no fetch)', async () => {
    useAuthMock.mockReturnValue({ user: null })
    const spy = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ json: () => Promise.resolve({ coupon: null }) }))
    global.fetch = spy as any
    const { container } = render(<ReviewCouponPopup />)
    expect(container.firstChild).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('renders nothing when the API returns no coupon', async () => {
    mockFetch({ coupon: null })
    const { container } = render(<ReviewCouponPopup />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('shows the percentage reward card when a coupon loads', async () => {
    mockFetch({ coupon: coupon() })
    render(<ReviewCouponPopup />)
    await screen.findByText('SAVE10')
    expect(screen.getByText('You earned a reward!')).toBeInTheDocument()
    expect(screen.getByText('10% off on your next order')).toBeInTheDocument()
    expect(screen.getByText('For leaving a review')).toBeInTheDocument()
  })

  it('formats a fixed discount in rupees', async () => {
    mockFetch({ coupon: coupon({ discount_type: 'fixed', discount_value: 150 }) })
    render(<ReviewCouponPopup />)
    await screen.findByText('₹150 off on your next order')
  })

  it('apply link points at the cart with the coupon code', async () => {
    mockFetch({ coupon: coupon() })
    render(<ReviewCouponPopup />)
    await screen.findByText('SAVE10')
    expect(screen.getByRole('link', { name: /Apply in cart/ })).toHaveAttribute('href', '/cart?coupon=SAVE10')
  })

  it('dismisses the popup and records the dismissal in sessionStorage', async () => {
    mockFetch({ coupon: coupon() })
    render(<ReviewCouponPopup />)
    await screen.findByText('SAVE10')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('SAVE10')).not.toBeInTheDocument()
    expect(sessionStorage.getItem('rfcoupon_dismissed')).toBe('1')
  })

  it('does not fetch or show when already dismissed this session', () => {
    sessionStorage.setItem('rfcoupon_dismissed', '1')
    const spy = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ json: () => Promise.resolve({ coupon: coupon() }) }))
    global.fetch = spy as any
    const { container } = render(<ReviewCouponPopup />)
    expect(spy).not.toHaveBeenCalled()
    expect(container.firstChild).toBeNull()
  })
})
