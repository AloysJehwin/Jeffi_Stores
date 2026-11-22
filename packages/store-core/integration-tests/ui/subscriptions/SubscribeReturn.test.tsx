import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// useSearchParams is the only external dep; the ?sub= param drives the initial branch.
const searchGet = vi.fn<(k: string) => string | null>()
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchGet }),
}))

import { SubscribeReturn } from '@/components/subscriptions/SubscribeReturn'

describe('SubscribeReturn (render + branches)', () => {
  beforeEach(() => {
    searchGet.mockReset()
    // Keep fetch from touching the network on the checking-phase effect.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('shows the checking state with a live region while a sub id polls', () => {
    searchGet.mockReturnValue('sub_123')
    render(<SubscribeReturn isBusiness={false} />)
    expect(screen.getByText(/Confirming your UPI Autopay/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('shows the failed state with a continue-shopping link when the sub id is missing', () => {
    searchGet.mockReturnValue('')
    render(<SubscribeReturn isBusiness={false} />)
    expect(screen.getByText('Subscription not started')).toBeInTheDocument()
    expect(screen.getByText(/mandate was not approved/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Continue shopping' })
    expect(link).toHaveAttribute('href', '/')
  })

  it('routes the business continue-shopping link through the business path prefix', () => {
    searchGet.mockReturnValue('')
    render(<SubscribeReturn isBusiness={true} />)
    const link = screen.getByRole('link', { name: 'Continue shopping' })
    expect(link.getAttribute('href')).toContain('/business')
  })
})
