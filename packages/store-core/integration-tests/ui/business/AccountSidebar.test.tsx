import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
let pathname = '/business/account'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
const flags = { subscriptionsEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import BusinessAccountSidebar, { BusinessAccountNavBar, navItems } from '@/components/business/AccountSidebar'

describe('Business account sidebar', () => {
  beforeEach(() => {
    pathname = '/business/account'
    flags.subscriptionsEnabled = true
  })

  it('links every account section, with Subscriptions after My Orders when enabled', () => {
    render(<BusinessAccountSidebar />)
    expect(screen.getAllByRole('link').map(l => l.textContent)).toEqual(['Profile', 'My Orders', 'Subscriptions', 'My Quotes', 'Transactions', 'My Addresses'])
    expect(screen.getByRole('link', { name: 'My Quotes' })).toHaveAttribute('href', '/business/quotes')
  })

  it('leaves Subscriptions out when the store has them off', () => {
    flags.subscriptionsEnabled = false
    render(<BusinessAccountSidebar />)
    expect(screen.queryByRole('link', { name: 'Subscriptions' })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(navItems.length)
  })

  it('highlights Profile only on the exact path, and a section for any path under it', () => {
    pathname = '/business/account/orders/o1'
    render(<BusinessAccountSidebar />)
    expect(screen.getByRole('link', { name: 'My Orders' }).className).toContain('bg-accent-50')
    expect(screen.getByRole('link', { name: 'Profile' }).className).not.toContain('bg-accent-50')
  })
})

describe('BusinessAccountNavBar', () => {
  beforeEach(() => {
    flags.subscriptionsEnabled = true
  })

  it('names the active section', () => {
    pathname = '/business/account/transactions'
    render(<BusinessAccountNavBar />)
    expect(screen.getAllByText('Transactions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Transactions')[0].tagName).toBe('SPAN')
  })

  it('falls back to My Account off the account pages', () => {
    pathname = '/business/elsewhere'
    render(<BusinessAccountNavBar />)
    expect(screen.getByText('My Account')).toBeInTheDocument()
  })

  it('offers a back link from an order detail to the orders list, and from a quote to quotes', () => {
    pathname = '/business/account/orders/o1'
    const { unmount } = render(<BusinessAccountNavBar />)
    const orders = screen.getAllByRole('link', { name: 'My Orders' })
    expect(orders).toHaveLength(2)
    expect(orders[1]).toHaveAttribute('href', '/business/account/orders')
    unmount()
    pathname = '/business/quotes/q9'
    render(<BusinessAccountNavBar />)
    expect(screen.getAllByRole('link', { name: 'My Quotes' })).toHaveLength(2)
  })

  it('has no back link on a top-level section', () => {
    pathname = '/business/account/orders'
    render(<BusinessAccountNavBar />)
    expect(screen.getAllByRole('link', { name: 'My Orders' })).toHaveLength(1)
  })
})
