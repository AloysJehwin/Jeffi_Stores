import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

// next/link -> plain anchor so href assertions work in happy-dom.
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import AccountCoupons from '@/components/visitor/account/AccountCoupons'
import type { AccountCoupon } from '@/lib/rewards/account-coupons'

const coupon = (over: Partial<AccountCoupon> = {}): AccountCoupon => ({
  id: 'c1',
  code: 'SAVE10',
  source: 'game',
  label: null,
  discountType: 'percentage',
  value: 10,
  minPurchase: 500,
  maxDiscount: 150,
  validUntil: null,
  createdAt: '2026-11-01',
  status: 'usable',
  ...over,
})

describe('AccountCoupons (render + branches + copy)', () => {
  beforeEach(() => {
    showToast.mockReset()
    window.location.hash = ''
  })

  it('renders nothing when there are no coupons', () => {
    const { container } = render(<AccountCoupons coupons={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a usable coupon with code, terms, status badge and both actions', () => {
    render(<AccountCoupons coupons={[coupon()]} />)
    expect(screen.getByText('SAVE10')).toBeInTheDocument()
    expect(screen.getByText('Ready to use')).toBeInTheDocument()
    // percentage terms rendered from couponTerms.
    expect(screen.getByText(/10% off \(up to ₹150\) on orders of ₹500 or more/)).toBeInTheDocument()
    expect(screen.getByText('Won in the rewards game')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy coupon SAVE10' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apply in cart' })).toHaveAttribute('href', '/cart?coupon=SAVE10')
  })

  it('hides Copy/Apply actions for a used coupon and shows its status', () => {
    render(<AccountCoupons coupons={[coupon({ status: 'used' })]} />)
    expect(screen.getByText('Used')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy coupon/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Apply in cart' })).not.toBeInTheDocument()
  })

  it('labels a loyalty-source coupon and an expired one', () => {
    render(<AccountCoupons coupons={[coupon({ source: 'loyalty', status: 'expired' })]} />)
    expect(screen.getByText('Redeemed points')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('copies the code to the clipboard and toasts success', async () => {
    const writeText = vi.fn<(...a: any[]) => any>(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AccountCoupons coupons={[coupon()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy coupon SAVE10' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SAVE10'))
    expect(showToast).toHaveBeenLastCalledWith('Coupon code copied', 'success')
  })

  it('toasts an error when the clipboard write rejects', async () => {
    const writeText = vi.fn<(...a: any[]) => any>(() => Promise.reject(new Error('no')))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AccountCoupons coupons={[coupon()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy coupon SAVE10' }))
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Could not copy the code', 'error'))
  })
})
