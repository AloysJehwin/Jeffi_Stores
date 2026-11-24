import { describe, it, expect, vi } from 'vitest'
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
const auth: { user: any } = { user: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { subscriptionsEnabled: false } }) }))
vi.mock('@/lib/shared/business-path', () => ({ bp: (p: string) => p }))

import BusinessAccountMobileHeader, { BusinessAccountMobileTabBar } from '@/components/business/AccountMobileHeader'

describe('BusinessAccountMobileHeader', () => {
  it('renders nothing without a signed-in user', () => {
    auth.user = null
    const { container } = render(<BusinessAccountMobileHeader />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the user name, email, initials and the nav tabs', () => {
    auth.user = { firstName: 'Priya', lastName: 'Shah', email: 'priya@example.com' }
    render(<BusinessAccountMobileHeader />)
    expect(screen.getByText('My Account')).toBeInTheDocument()
    expect(screen.getByText('Priya Shah')).toBeInTheDocument()
    expect(screen.getByText('priya@example.com')).toBeInTheDocument()
    expect(screen.getByText('PS')).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(2)
  })

  it('uses the avatar image when there is one', () => {
    auth.user = { firstName: 'Priya', lastName: 'Shah', email: 'p@x.com', avatarUrl: '/me.png' }
    render(<BusinessAccountMobileHeader />)
    expect(screen.getByAltText('Priya')).toHaveAttribute('src', '/me.png')
  })

  it('tab bar highlights the active tab', () => {
    pathname = '/business/account'
    render(<BusinessAccountMobileTabBar />)
    const active = screen.getAllByRole('link').filter(a => a.className.includes('border-accent-500'))
    expect(active.length).toBeGreaterThanOrEqual(1)
  })
})
