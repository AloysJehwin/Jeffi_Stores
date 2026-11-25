import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
let pathname = '/business'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/components/visitor/SearchBar', () => ({
  default: ({ isOpen, onOpen, onClose, basePath }: any) => (
    <div data-testid="search" data-open={String(isOpen)} data-base={basePath}>
      <button onClick={onOpen}>open-search</button>
      <button onClick={onClose}>close-search</button>
    </div>
  ),
}))
vi.mock('@/components/ThemeToggle', () => ({ default: () => <button>theme-toggle</button> }))
const cart = { cartCount: 0 }
vi.mock('@/contexts/CartContext', () => ({ useCart: () => cart }))
const logout = vi.fn()
const auth: { user: any; logout: () => void } = { user: null, logout }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const identity = { name: 'Halo Business', logoUrl: '/logo.png' }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity }) }))

import BusinessHeader from '@/components/business/Header'

const user = { firstName: 'Asha', lastName: 'Rao', email: 'asha@acme.test', avatarUrl: null }

describe('BusinessHeader', () => {
  beforeEach(() => {
    pathname = '/business'
    cart.cartCount = 0
    auth.user = user
  })

  it('shows the brand and the portal navigation, lighting only the current page', () => {
    pathname = '/business/products'
    render(<BusinessHeader />)
    expect(screen.getAllByText('Halo Business')[0]).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { hidden: true })
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map(a => a.textContent)).toEqual(['Home', 'Products', 'Categories', 'About Us', 'Support'])
    expect(links[1].className).toContain('text-accent-500')
    expect(links[0].className).not.toContain('text-accent-500 ')
    expect(screen.getByTestId('search')).toHaveAttribute('data-base', '/business/products')
  })

  it('shows the cart count only when the cart has items', () => {
    const { unmount } = render(<BusinessHeader />)
    expect(screen.queryByText('3')).toBeNull()
    unmount()
    cart.cartCount = 3
    render(<BusinessHeader />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('opens the user menu with account links and signs out', () => {
    render(<BusinessHeader />)
    expect(screen.queryByRole('link', { name: 'My Profile' })).toBeNull()
    fireEvent.click(screen.getByText('Asha').closest('button')!)
    expect(screen.getByRole('link', { name: 'My Profile' })).toHaveAttribute('href', '/business/account')
    expect(screen.getByRole('link', { name: 'My Quotes' })).toHaveAttribute('href', '/business/quotes')
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    expect(logout).toHaveBeenCalled()
  })

  it('closes the user menu on an outside click', () => {
    render(<BusinessHeader />)
    fireEvent.click(screen.getByText('Asha').closest('button')!)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('link', { name: 'My Profile' })).toBeNull()
  })

  it('falls back to a generic account label without a signed-in user', () => {
    auth.user = null
    render(<BusinessHeader />)
    expect(screen.getByText('Account')).toBeInTheDocument()
  })

  it('hides the desktop nav while search is open', () => {
    render(<BusinessHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'open-search' }))
    expect(screen.getByTestId('search')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('navigation', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'close-search' }))
    expect(screen.getByRole('navigation', { hidden: true })).toHaveAttribute('aria-hidden', 'false')
  })

  it('opens the mobile drawer with the user card, closes it, and signs out from it', () => {
    cart.cartCount = 2
    render(<BusinessHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByText('asha@acme.test')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('AR')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign Out' }).at(-1)!)
    expect(logout).toHaveBeenCalled()
    expect(screen.queryByText('asha@acme.test')).toBeNull()
  })

  it('shows the avatar image in the drawer when the user has one', () => {
    auth.user = { ...user, avatarUrl: '/me.png' }
    render(<BusinessHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByAltText('Asha')).toHaveAttribute('src', '/me.png')
  })
})
