import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => params }))
let user: any = { id: 'u1' }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))

import CouponHintBanner from '@/components/visitor/CouponHintBanner'

const fetchMock = vi.fn()
const reply = (data: any) => fetchMock.mockResolvedValue({ json: async () => data })

describe('CouponHintBanner', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    params = new URLSearchParams()
    user = { id: 'u1' }
  })

  it('does not fetch for a signed-out visitor', () => {
    user = null
    const { container } = render(<CouponHintBanner />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('does not fetch when a coupon is already applied in the URL', () => {
    params = new URLSearchParams('couponCode=X')
    const { container } = render(<CouponHintBanner />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a percentage coupon and applies it to the URL', async () => {
    reply({ coupon: { id: 'c', code: 'THANKS10', discount_type: 'percentage', discount_value: 10 } })
    render(<CouponHintBanner />)
    expect(await screen.findByText('THANKS10')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/review-coupons')
    expect(screen.getByText(/10% off/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain('couponCode=THANKS10')
  })

  it('formats a flat coupon in rupees and can be dismissed', async () => {
    reply({ coupon: { id: 'c', code: 'FLAT50', discount_type: 'fixed', discount_value: 50 } })
    render(<CouponHintBanner />)
    expect(await screen.findByText(/₹50 off/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(screen.queryByText('FLAT50')).not.toBeInTheDocument()
  })

  it('stays hidden when there is no coupon or the request fails', async () => {
    reply({})
    const { container, unmount } = render(<CouponHintBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()
    fetchMock.mockRejectedValue(new Error('offline'))
    const again = render(<CouponHintBanner />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(again.container).toBeEmptyDOMElement()
  })
})
