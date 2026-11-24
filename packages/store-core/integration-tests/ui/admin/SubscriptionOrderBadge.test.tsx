import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubscriptionOrderBadge from '@/components/admin/SubscriptionOrderBadge'

describe('SubscriptionOrderBadge', () => {
  it('renders nothing for a non-subscription order', () => {
    const { container } = render(<SubscriptionOrderBadge subscriptionId={null} cycle={2} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the cycle number when present', () => {
    render(<SubscriptionOrderBadge subscriptionId="sub1" cycle={3} className="ml-2" />)
    const el = screen.getByText('Subscription · cycle 3')
    expect(el.className).toMatch(/ml-2/)
  })

  it('omits the cycle when absent', () => {
    render(<SubscriptionOrderBadge subscriptionId="sub1" />)
    expect(screen.getByText('Subscription')).toBeInTheDocument()
  })
})
