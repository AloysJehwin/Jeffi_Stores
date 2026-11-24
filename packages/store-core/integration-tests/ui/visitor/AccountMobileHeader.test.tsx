import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let pathname = '/account'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let user: any = null
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/hooks/useLoyaltyEnabled', () => ({ useLoyaltyEnabled: () => false }))
vi.mock('@/hooks/useReferralEnabled', () => ({ useReferralEnabled: () => false }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: {} }) }))
vi.mock('@/contexts/AccountSearchContext', () => ({ useAccountSearch: () => ({}) }))

import AccountMobileHeader, { AccountMobileTabBar } from '@/components/visitor/AccountMobileHeader'

describe('AccountMobileHeader', () => {
  beforeEach(() => {
    pathname = '/account'
    user = { firstName: 'Asha', lastName: 'Rao', email: 'asha@x.test', avatarUrl: null, isBusiness: false }
  })

  it('renders nothing for a signed-out visitor', () => {
    user = null
    const { container } = render(<AccountMobileHeader />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the profile banner with name, email and initials', () => {
    render(<AccountMobileHeader />)
    expect(screen.getByRole('heading', { name: 'My Account' })).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('asha@x.test')).toBeInTheDocument()
    expect(screen.getByText('AR')).toBeInTheDocument()
    expect(screen.getByText('AR').closest('a')).toHaveAttribute('href', '/account')
  })

  it('uses the avatar image when there is one, and "U" when there is no name', () => {
    user.avatarUrl = '/me.png'
    const a = render(<AccountMobileHeader />)
    expect(screen.getByAltText('Asha')).toHaveAttribute('src', '/me.png')
    a.unmount()
    user = { firstName: '', lastName: '', email: 'x@y.z', avatarUrl: null }
    render(<AccountMobileHeader />)
    expect(screen.getByText('U')).toBeInTheDocument()
  })

  it('icon tabs link every account page and mark the current one', () => {
    pathname = '/account/orders/o1'
    render(<AccountMobileHeader />)
    expect(screen.getByRole('link', { name: 'My Orders' })).toHaveAttribute('href', '/account/orders')
    expect(screen.getByRole('link', { name: 'My Orders' }).className).toContain('border-accent-500')
    expect(screen.getByRole('link', { name: 'Profile' }).className).not.toContain('border-accent-500')
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
  })
})

describe('AccountMobileTabBar', () => {
  beforeEach(() => {
    pathname = '/wishlist'
    user = { isBusiness: false }
  })

  it('is just the tabs, with the current page highlighted', () => {
    render(<AccountMobileTabBar />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wishlist' }).className).toContain('border-accent-500')
    expect(screen.queryByRole('link', { name: 'My Quotes' })).not.toBeInTheDocument()
  })

  it('adds My Quotes for an approved business account only', () => {
    user = { isBusiness: true, approvalStatus: 'approved' }
    const a = render(<AccountMobileTabBar />)
    expect(screen.getByRole('link', { name: 'My Quotes' })).toHaveAttribute('href', '/account/quotes')
    a.unmount()
    user = { isBusiness: true, approvalStatus: 'pending' }
    render(<AccountMobileTabBar />)
    expect(screen.queryByRole('link', { name: 'My Quotes' })).not.toBeInTheDocument()
  })
})
