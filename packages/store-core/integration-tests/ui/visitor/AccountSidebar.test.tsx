import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'

let pathname = '/account'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let user: any = { isBusiness: false }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
let search = { query: '', suggestions: [] as string[], placeholder: 'Search…', setQuery: vi.fn() }
vi.mock('@/contexts/AccountSearchContext', () => ({ useAccountSearch: () => search }))
vi.mock('@/components/visitor/AccountSearch', () => ({
  default: ({ placeholder }: any) => <input aria-label="account search" placeholder={placeholder} />,
}))
let loyalty = false
let referral = false
let subscriptions = false
vi.mock('@/hooks/useLoyaltyEnabled', () => ({ useLoyaltyEnabled: () => loyalty }))
vi.mock('@/hooks/useReferralEnabled', () => ({ useReferralEnabled: () => referral }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { subscriptionsEnabled: subscriptions } }) }))

import AccountSidebar, { AccountNavBar, navItems, useAccountNavItems } from '@/components/visitor/AccountSidebar'

const labels = () => screen.getAllByRole('link').map(l => l.textContent)

describe('AccountSidebar', () => {
  beforeEach(() => {
    pathname = '/account'
    user = { isBusiness: false }
    loyalty = referral = subscriptions = false
    search = { query: '', suggestions: [], placeholder: 'Search…', setQuery: vi.fn() }
  })

  it('lists the base account links and highlights the current page', () => {
    pathname = '/account/orders/ord_1'
    render(<AccountSidebar />)
    expect(labels()).toEqual(['Profile', 'My Orders', 'Transactions', 'My Addresses', 'Wishlist'])
    expect(screen.getByRole('link', { name: 'My Orders' }).className).toContain('bg-accent-50')
    expect(screen.getByRole('link', { name: 'Profile' }).className).not.toContain('bg-accent-50')
  })

  it('Profile is only active on the exact /account path', () => {
    pathname = '/account/addresses'
    render(<AccountSidebar />)
    expect(screen.getByRole('link', { name: 'Profile' }).className).not.toContain('bg-accent-50')
    expect(screen.getByRole('link', { name: 'My Addresses' }).className).toContain('bg-accent-50')
  })

  it('adds Subscriptions, Rewards and Refer & Earn when those features are on', () => {
    subscriptions = loyalty = referral = true
    render(<AccountSidebar />)
    expect(labels()).toEqual(['Profile', 'My Orders', 'Subscriptions', 'Transactions', 'My Addresses', 'Wishlist', 'Rewards', 'Refer & Earn'])
  })

  it('Rewards without referral omits Refer & Earn; business accounts get no rewards at all', () => {
    loyalty = true
    const a = render(<AccountSidebar />)
    expect(labels()).toContain('Rewards')
    expect(labels()).not.toContain('Refer & Earn')
    a.unmount()
    user = { isBusiness: true, approvalStatus: 'approved' }
    render(<AccountSidebar />)
    expect(labels()).not.toContain('Rewards')
    expect(labels()).toContain('My Quotes')
  })

  it('an unapproved business account does not see My Quotes', () => {
    user = { isBusiness: true, approvalStatus: 'pending' }
    render(<AccountSidebar />)
    expect(labels()).not.toContain('My Quotes')
  })
})

describe('useAccountNavItems / navItems', () => {
  it('exports the base nav and the hook returns it by default', () => {
    expect(navItems.map(n => n.label)).toEqual(['Profile', 'My Orders', 'Transactions', 'My Addresses', 'Wishlist'])
    const { result } = renderHook(() => useAccountNavItems())
    expect(result.current).toBe(navItems)
  })
})

describe('AccountNavBar', () => {
  beforeEach(() => {
    pathname = '/account/transactions'
    user = { isBusiness: false }
    loyalty = referral = subscriptions = false
    search = { query: '', suggestions: [], placeholder: 'Search…', setQuery: vi.fn() }
  })

  it('shows the active section label and nav links', () => {
    render(<AccountNavBar />)
    expect(screen.getAllByText('Transactions').length).toBe(2)
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
    expect(screen.queryByLabelText('account search')).not.toBeInTheDocument()
  })

  it('falls back to "My Account" for a path outside the nav', () => {
    pathname = '/somewhere'
    render(<AccountNavBar />)
    expect(screen.getByText('My Account')).toBeInTheDocument()
  })

  it('shows a back link on detail pages instead of search', () => {
    pathname = '/account/orders/ord_1'
    search = { ...search, suggestions: ['a'] }
    render(<AccountNavBar />)
    // nav item + the back link, both to the orders list
    expect(screen.getAllByRole('link', { name: 'My Orders' })).toHaveLength(2)
    expect(screen.queryByLabelText('account search')).not.toBeInTheDocument()
  })

  it('renders the search box when the page registered suggestions or a custom placeholder', () => {
    search = { ...search, suggestions: ['Order #1'], placeholder: 'Search orders' }
    render(<AccountNavBar />)
    expect(screen.getByLabelText('account search')).toHaveAttribute('placeholder', 'Search orders')
  })

  it('includes My Quotes for an approved business account', () => {
    user = { isBusiness: true, approvalStatus: 'approved' }
    render(<AccountNavBar />)
    expect(screen.getByRole('link', { name: 'My Quotes' })).toHaveAttribute('href', '/account/quotes')
  })
})
