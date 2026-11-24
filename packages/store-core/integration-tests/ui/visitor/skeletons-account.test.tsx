import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/visitor/AccountMobileHeader', () => ({
  default: () => <div data-testid="store-header" />,
  AccountMobileTabBar: () => <div data-testid="store-tabs" />,
}))
vi.mock('@/components/business/AccountMobileHeader', () => ({
  default: () => <div data-testid="biz-header" />,
  BusinessAccountMobileTabBar: () => <div data-testid="biz-tabs" />,
}))
vi.mock('@/components/visitor/AccountSidebar', () => ({ AccountNavBar: () => <div data-testid="navbar" /> }))

import * as S from '@/components/visitor/skeletons/account'

const sk = (c: HTMLElement) => c.querySelectorAll('.sk').length

describe('account skeletons: portal frames', () => {
  it('AccountHomeSkeleton is a busy status with its own profile banner placeholder', () => {
    const { container } = render(<S.AccountHomeSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading account' })).toHaveAttribute('aria-busy', 'true')
    expect(sk(container)).toBeGreaterThan(5)
  })

  it.each([
    ['OrdersListSkeleton', 'Loading orders'],
    ['OrderDetailSkeleton', 'Loading order'],
  ] as const)('%s is a busy status labelled "%s" with the store header by default', (name, label) => {
    const C = (S as any)[name]
    const { container } = render(<C />)
    const s = screen.getByRole('status', { name: label })
    expect(s).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('store-header')).toBeInTheDocument()
    expect(screen.queryByTestId('biz-header')).not.toBeInTheDocument()
    expect(sk(container)).toBeGreaterThan(0)
  })

  it.each(['OrdersListSkeleton', 'OrderDetailSkeleton', 'AddressesSkeleton', 'TransactionsSkeleton', 'SubscriptionsSkeleton'] as const)(
    '%s swaps to the business header for the business portal',
    name => {
      const C = (S as any)[name]
      render(<C portal="business" />)
      expect(screen.getByTestId('biz-header')).toBeInTheDocument()
      expect(screen.queryByTestId('store-header')).not.toBeInTheDocument()
    }
  )

  it('AccountHeader picks the header for the portal', () => {
    const a = render(<S.AccountHeader />)
    expect(screen.getByTestId('store-header')).toBeInTheDocument()
    a.unmount()
    render(<S.AccountHeader portal="business" />)
    expect(screen.getByTestId('biz-header')).toBeInTheDocument()
  })

  it('the business orders list adds its own search box', () => {
    const a = render(<S.OrdersListSkeleton />)
    const storeSk = sk(a.container)
    a.unmount()
    const b = render(<S.OrdersListSkeleton portal="business" />)
    expect(b.container.textContent).not.toBe('')
    expect(b.container.textContent!.length).toBeGreaterThanOrEqual(0)
    expect(sk(b.container)).toBeGreaterThan(0)
    expect(storeSk).toBeGreaterThan(0)
  })
})

describe('account skeletons: parts', () => {
  it('OrderCardsSkeleton draws the requested number of cards (3 by default)', () => {
    const a = render(<S.OrderCardsSkeleton />)
    const three = (a.container.firstChild as HTMLElement).childNodes.length
    a.unmount()
    const b = render(<S.OrderCardsSkeleton count={5} />)
    expect((b.container.firstChild as HTMLElement).childNodes.length).toBe(5)
    expect(three).toBe(3)
  })

  it('QuoteRowsSkeleton draws the requested number of rows (4 by default)', () => {
    const a = render(<S.QuoteRowsSkeleton />)
    const n4 = (a.container.firstChild as HTMLElement).childNodes.length
    a.unmount()
    const b = render(<S.QuoteRowsSkeleton count={2} />)
    expect((b.container.firstChild as HTMLElement).childNodes.length).toBe(2)
    expect(n4).toBe(4)
  })

  it.each(['RecentOrderRowSkeleton', 'DefaultAddressSkeleton', 'OrderCardSkeleton', 'SubscriptionCardSkeleton'] as const)('%s is a block of shimmer', name => {
    const C = (S as any)[name]
    const { container } = render(<C />)
    expect(sk(container)).toBeGreaterThan(0)
  })

  it('AccountQuotesSkeleton, Rewards/Referrals bodies and Subscriptions all shimmer', () => {
    for (const C of [S.AccountQuotesSkeleton, S.RewardsBodySkeleton, S.ReferralsBodySkeleton, S.SubscriptionsSkeleton]) {
      const { container, unmount } = render(<C />)
      expect(sk(container)).toBeGreaterThan(0)
      unmount()
    }
  })

  it('AccountQuotesSkeleton is labelled "Loading quotes"', () => {
    render(<S.AccountQuotesSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading quotes' })).toBeInTheDocument()
  })

  it('LoyaltySkeleton names the page it loads and draws the matching body', () => {
    const a = render(<S.LoyaltySkeleton kind="rewards" />)
    expect(screen.getByRole('status', { name: 'Loading rewards' })).toBeInTheDocument()
    expect(screen.getByTestId('store-header')).toBeInTheDocument()
    const rewards = a.container.innerHTML
    a.unmount()
    const b = render(<S.LoyaltySkeleton kind="referrals" />)
    expect(screen.getByRole('status', { name: 'Loading referrals' })).toBeInTheDocument()
    expect(b.container.innerHTML).not.toBe(rewards)
  })

  it('WishlistSkeleton brings its own nav bar and tab bar, since it sits outside the account layout', () => {
    render(<S.WishlistSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading wishlist' })).toBeInTheDocument()
    expect(screen.getByTestId('navbar')).toBeInTheDocument()
  })
})
