import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let user: any = null
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))

import BusinessPriceBadge from '@/components/visitor/BusinessPriceBadge'

const biz = (over: Record<string, any> = {}) => ({
  isBusiness: true,
  approvalStatus: 'approved',
  businessDiscountMap: { cat1: 10 },
  ...over,
})

describe('BusinessPriceBadge', () => {
  beforeEach(() => {
    user = biz()
  })

  it('shows the extra discount and the discounted price for an approved business user', () => {
    render(<BusinessPriceBadge price={1000} categoryId="cat1" />)
    expect(screen.getByText('Business 10% extra off')).toBeInTheDocument()
    expect(screen.getByText('Rs. 900.00')).toBeInTheDocument()
    expect(screen.getByText('Your exclusive business price')).toBeInTheDocument()
  })

  it.each([
    ['signed out', null, 'cat1'],
    ['not a business account', biz({ isBusiness: false }), 'cat1'],
    ['approval pending', biz({ approvalStatus: 'pending' }), 'cat1'],
    ['no category id', biz(), undefined],
    ['no discount map', biz({ businessDiscountMap: undefined }), 'cat1'],
    ['no discount for the category', biz(), 'other'],
    ['zero discount', biz({ businessDiscountMap: { cat1: 0 } }), 'cat1'],
  ])('renders nothing when %s', (_n, u, cat) => {
    user = u
    const { container } = render(<BusinessPriceBadge price={1000} categoryId={cat as string | undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
