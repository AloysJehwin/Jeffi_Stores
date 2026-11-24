import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const logout = vi.fn()
let user: any = null
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user, logout }) }))
let cartCount = 0
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ cartCount }) }))
let wishCount = 0
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => ({ count: wishCount }) }))
let cfg: any
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => cfg }))
vi.mock('@/components/ThemeToggle', () => ({ default: () => <button>theme</button> }))
vi.mock('@/components/visitor/CookieConsentBanner', () => ({ CookieSettingsLink: () => <button>Cookie settings</button> }))

import MobileDrawer from '@/components/visitor/MobileDrawer'

const fetchMock = vi.fn()
const cats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, slug: `cat-${i}`, parent_category_id: null }))

describe('MobileDrawer', () => {
  beforeEach(() => {
    pathname = '/'
    user = null
    cartCount = wishCount = 0
    cfg = { identity: { name: 'Halo', logoUrl: null }, chrome: undefined }
    logout.mockReset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    document.body.style.overflow = ''
  })

  it('is an off-screen modal dialog when closed and does not fetch categories', () => {
    render(<MobileDrawer isOpen={false} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Menu', hidden: true })
    expect(dialog.className).toContain('invisible')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
  })

  it('when open: locks scroll, focuses close, shows the default nav and the logged-out auth links', () => {
    render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Menu' }).className).toContain('translate-x-0')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toHaveTextContent('HomeProductsCategoriesAbout UsSupportContact')
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Sign Up' })).toHaveAttribute('href', '/signup')
  })

  it('marks the current page and uses Site Builder links when set', () => {
    pathname = '/products'
    const a = render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
    a.unmount()
    cfg.chrome = { nav: [{ href: '/sale', label: 'Sale' }] }
    render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveTextContent('Sale')
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument()
  })

  it('closes from the close button, the backdrop, the brand link and Escape', () => {
    const onClose = vi.fn()
    const { container } = render(<MobileDrawer isOpen onClose={onClose} />)
    onClose.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    fireEvent.click(container.querySelector('[aria-hidden="true"].fixed')!)
    fireEvent.click(screen.getByRole('link', { name: 'Halo' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('traps Tab inside the panel (wraps last to first and back)', () => {
    render(<MobileDrawer isOpen onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
    items[items.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(items[items.length - 1]).toHaveFocus()
    delete (HTMLElement.prototype as any).offsetParent
  })

  it('fetches top-level categories once on open, caps at 12 and links to all categories', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ categories: [...cats(14), { id: 'sub', name: 'Child', slug: 'child', parent_category_id: 'c0' }] }) })
    const { rerender } = render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(await screen.findByText('Shop by category')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cat 0' })).toHaveAttribute('href', '/categories/cat-0')
    expect(screen.queryByText('Cat 12')).not.toBeInTheDocument()
    expect(screen.queryByText('Child')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All categories' })).toHaveAttribute('href', '/categories')
    rerender(<MobileDrawer isOpen={false} onClose={vi.fn()} />)
    rerender(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('hides the category block when the request fails or fails to parse', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<MobileDrawer isOpen onClose={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Shop by category')).not.toBeInTheDocument()
  })

  it('shows cart and wishlist counts when non-zero', () => {
    cartCount = 3
    wishCount = 2
    render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Cart/ })).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /Wishlist/ })).toHaveTextContent('2')
  })

  it('signed in: shows the user, account links, and logs out and closes', () => {
    user = { firstName: 'Asha', lastName: 'Rao', email: 'asha@x.test', avatarUrl: null }
    const onClose = vi.fn()
    render(<MobileDrawer isOpen onClose={onClose} />)
    expect(screen.getByText('AR')).toBeInTheDocument()
    expect(screen.getByText('asha@x.test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My Orders' })).toHaveAttribute('href', '/account/orders')
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
    onClose.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(logout).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('uses the avatar image and the store logo when provided', () => {
    user = { firstName: 'Asha', lastName: '', email: 'a@x.test', avatarUrl: '/me.png' }
    cfg.identity.logoUrl = '/logo.png'
    const { container } = render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(screen.getByAltText('Asha')).toHaveAttribute('src', '/me.png')
    expect(container.querySelector('img[src="/logo.png"]')).not.toBeNull()
  })

  it('closes itself when the route changes', () => {
    const onClose = vi.fn()
    const { rerender } = render(<MobileDrawer isOpen onClose={onClose} />)
    onClose.mockClear()
    pathname = '/about'
    rerender(<MobileDrawer isOpen onClose={onClose} />)
    expect(onClose).toHaveBeenCalled()
  })

  it('releases the scroll lock on unmount', () => {
    const { unmount } = render(<MobileDrawer isOpen onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
