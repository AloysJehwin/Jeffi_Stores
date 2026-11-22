import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { AccountCoupon } from '@/lib/rewards/account-coupons'

// YourCoupons lists the signed-in customer's usable coupons from useAccountCoupons (which we mock) and
// applies one on tap. couponTerms runs for real on the supplied data.

const useAccountCoupons = vi.fn<(...a: any[]) => any>()
vi.mock('@/components/visitor/coupons/useAccountCoupons', () => ({
  useAccountCoupons: (...a: any[]) => useAccountCoupons(...a),
}))

import YourCoupons from '@/components/visitor/cart/YourCoupons'

function coupon(over: Partial<AccountCoupon> = {}): AccountCoupon {
  return {
    id: 'c1',
    code: 'WIN100',
    discountType: 'fixed',
    value: 100,
    minPurchase: 0,
    maxDiscount: null,
    validUntil: null,
    ...(over as object),
  } as AccountCoupon
}

beforeEach(() => {
  useAccountCoupons.mockReset()
})

describe('YourCoupons', () => {
  it('renders nothing before coupons load (null)', () => {
    useAccountCoupons.mockReturnValue({ coupons: null })
    const { container } = render(<YourCoupons subtotal={500} applying={false} onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the customer has no usable coupons', () => {
    useAccountCoupons.mockReturnValue({ coupons: [] })
    const { container } = render(<YourCoupons subtotal={500} applying={false} onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists a usable coupon and fires onApply with its code on tap', () => {
    useAccountCoupons.mockReturnValue({ coupons: [coupon({ code: 'WIN100' })] })
    const onApply = vi.fn<(...a: any[]) => any>()
    render(<YourCoupons subtotal={500} applying={false} onApply={onApply} />)
    expect(screen.getByText('WIN100')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply coupon WIN100' }))
    expect(onApply).toHaveBeenCalledWith('WIN100')
  })

  it('disables Apply and shows the shortfall when the min purchase is not met', () => {
    useAccountCoupons.mockReturnValue({ coupons: [coupon({ code: 'BIG', minPurchase: 800 })] })
    const onApply = vi.fn<(...a: any[]) => any>()
    render(<YourCoupons subtotal={500} applying={false} onApply={onApply} />)
    // ₹300 shortfall.
    expect(screen.getByText('₹300.00')).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Apply coupon BIG' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows a See all link only when more than three coupons exist', () => {
    const many = Array.from({ length: 4 }, (_, i) => coupon({ id: `c${i}`, code: `C${i}` }))
    useAccountCoupons.mockReturnValue({ coupons: many })
    render(<YourCoupons subtotal={500} applying={false} onApply={() => {}} />)
    const link = screen.getByRole('link', { name: 'See all' })
    expect(link).toHaveAttribute('href', '/account/rewards#coupons')
    // Only the first three are listed.
    expect(screen.getByText('C0')).toBeInTheDocument()
    expect(screen.queryByText('C3')).not.toBeInTheDocument()
  })

  it('shows Applying… on every Apply button while applying', () => {
    useAccountCoupons.mockReturnValue({ coupons: [coupon()] })
    render(<YourCoupons subtotal={500} applying onApply={() => {}} />)
    expect(screen.getByText('Applying...')).toBeInTheDocument()
  })
})
