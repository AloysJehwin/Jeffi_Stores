import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
let cartCount = 0
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ cartCount }) }))
let wishCount = 0
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => ({ count: wishCount }) }))
let cfg: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))
vi.mock('@/lib/client/use-cart-pulse', () => ({ useCartPulse: (n: number) => n > 0 }))
vi.mock('@/components/visitor/SearchBar', () => ({
  default: ({ isOpen, onOpen, onClose }: any) => (
    <div data-testid="search" data-open={String(isOpen)}>
      <button onClick={onOpen}>open search</button>
      <button onClick={onClose}>close search</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/UserMenu', () => ({ default: () => <div data-testid="user-menu" /> }))
vi.mock('@/components/visitor/MobileDrawer', () => ({ default: ({ isOpen, onClose }: any) => <div data-testid="drawer" data-open={String(isOpen)}><button onClick={onClose}>drawer close</button></div> }))
vi.mock('@/components/ThemeToggle', () => ({ default: () => <div data-testid="theme" /> }))
vi.mock('@/components/visitor/AiAssistantButton', () => ({ default: () => <div data-testid="ai" /> }))
vi.mock('@/components/visitor/site/code/parts/chrome/marks', () => ({ StoreLogoMark: ({ name, tagline }: any) => <span>{`${name}|${tagline ?? ''}`}</span> }))
vi.mock('@/components/visitor/site/code/parts/chrome/CartLink', () => ({ default: ({ count }: any) => <a href="/cart" aria-label="cart">{`cart:${count}`}</a> }))

import Header from '@/components/visitor/Header'

describe('Header', () => {
  beforeEach(() => {
    cartCount = 0
    wishCount = 0
    cfg = { identity: { name: 'Halo', logoUrl: null }, storefront: { metaTagline: 'Sound, sorted' }, chrome: undefined }
  })

  it('shows the brand linking home, the default nav, search, wishlist, cart, user menu and theme', () => {
    render(<Header />)
    expect(screen.getByText('Halo|Sound, sorted').closest('a')).toHaveAttribute('href', '/')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(within_nav().length).toBeGreaterThan(0)
    expect(screen.getByTestId('search')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute('href', '/wishlist')
    expect(screen.getByText('cart:0')).toBeInTheDocument()
    expect(screen.getByTestId('user-menu')).toBeInTheDocument()
    expect(screen.getByTestId('theme')).toBeInTheDocument()
    expect(screen.getByTestId('ai')).toBeInTheDocument()
  })

  it('uses the Site Builder menu when set, hiding links past the third below xl', () => {
    cfg.chrome = { nav: ['A', 'B', 'C', 'D'].map(l => ({ href: `/${l}`, label: l })) }
    render(<Header />)
    expect(within_nav().map(l => l.textContent)).toEqual(['A', 'B', 'C', 'D'])
    expect(within_nav()[2].className).not.toContain('hidden xl:inline')
    expect(within_nav()[3].className).toContain('hidden xl:inline')
  })

  it('wishlist badge shows the count, capped at 99+, and names it for screen readers', () => {
    wishCount = 3
    const a = render(<Header />)
    expect(screen.getByRole('link', { name: 'Wishlist, 3 items' })).toHaveTextContent('3')
    a.unmount()
    wishCount = 120
    render(<Header />)
    expect(screen.getByRole('link', { name: 'Wishlist, 120 items' })).toHaveTextContent('99+')
  })

  it('the phone menu button carries the cart count and opens the drawer', () => {
    cartCount = 4
    render(<Header />)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-open', 'false')
    const btn = screen.getByRole('button', { name: 'Open menu, 4 in cart' })
    expect(btn).toHaveTextContent('4')
    fireEvent.click(btn)
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-open', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'drawer close' }))
    expect(screen.getByTestId('drawer')).toHaveAttribute('data-open', 'false')
  })

  it('an empty cart gives a plain "Open menu" label with no badge', () => {
    render(<Header />)
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveTextContent('')
  })

  it('opening search hides the desktop nav from assistive tech and closing restores it', () => {
    render(<Header />)
    const nav = screen.getByRole('navigation', { hidden: true })
    expect(nav).toHaveAttribute('aria-hidden', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'open search' }))
    expect(screen.getByTestId('search')).toHaveAttribute('data-open', 'true')
    expect(nav).toHaveAttribute('aria-hidden', 'true')
    expect(nav.className).toContain('invisible')
    fireEvent.click(screen.getByRole('button', { name: 'close search' }))
    expect(nav).toHaveAttribute('aria-hidden', 'false')
  })
})

function within_nav() {
  return Array.from(screen.getByRole('navigation', { hidden: true }).querySelectorAll('a'))
}
