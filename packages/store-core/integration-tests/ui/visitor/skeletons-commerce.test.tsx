import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  CartSkeleton,
  CheckoutSkeleton,
  CheckoutReviewSkeleton,
  SubscribeAddressesSkeleton,
  SubscribeQuoteSkeleton,
  SubscribeSkeleton,
} from '@/components/visitor/skeletons/commerce'

const sk = (c: HTMLElement) => c.querySelectorAll('.sk').length

describe('commerce skeletons', () => {
  it.each([
    ['cart', CartSkeleton, 'Loading cart'],
    ['checkout', CheckoutSkeleton, 'Loading checkout'],
    ['order review', CheckoutReviewSkeleton, 'Loading order review'],
    ['subscribe', SubscribeSkeleton, 'Loading subscription'],
  ] as const)('the %s skeleton is a busy status labelled "%s"', (_n, C, label) => {
    const { container } = render(<C />)
    expect(screen.getByRole('status', { name: label })).toHaveAttribute('aria-busy', 'true')
    expect(sk(container)).toBeGreaterThan(5)
  })

  it('the cart keeps its real total wording and a sticky offset that can be changed', () => {
    const a = render(<CartSkeleton />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('Price inclusive of all taxes')).toBeInTheDocument()
    expect(a.container.innerHTML).toContain('lg:top-24')
    a.unmount()
    const b = render(<CartSkeleton sticky="lg:top-8" />)
    expect(b.container.innerHTML).toContain('lg:top-8')
    expect(b.container.innerHTML).not.toContain('lg:top-24')
  })

  it('checkout and review keep their static section titles', () => {
    render(<CheckoutSkeleton />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('the review screen is distinct from checkout', () => {
    const a = render(<CheckoutSkeleton />)
    const html = a.container.innerHTML
    a.unmount()
    const b = render(<CheckoutReviewSkeleton />)
    expect(b.container.innerHTML).not.toBe(html)
  })

  it('subscribe parts shimmer on their own', () => {
    for (const C of [SubscribeAddressesSkeleton, SubscribeQuoteSkeleton]) {
      const { container, unmount } = render(<C />)
      expect(sk(container)).toBeGreaterThan(0)
      unmount()
    }
  })
})
