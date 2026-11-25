import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

let pathname: string | null = '/admin/orders'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import AdminMobileNav from '@/components/admin/AdminMobileNav'
import { AdminHostProvider } from '@/contexts/AdminHostContext'

const links = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/scan', label: 'Scan' },
  { href: '/admin/orders', label: 'Orders', group: 'Sales', matchPaths: ['/admin/returns'] },
  { href: '/admin/customers', label: 'Customers', group: 'Sales' },
  { href: '/admin/products', label: 'Products', group: 'Catalog' },
  { href: '/admin/settings', label: 'Settings', bottom: true },
]

let mqListeners: Array<(e: any) => void> = []
let mqMatches = false

function mount(host = 'shop.test') {
  return render(
    <AdminHostProvider host={host}>
      <AdminMobileNav navLinks={links} username="Asha" role="owner" />
    </AdminHostProvider>
  )
}

describe('AdminMobileNav', () => {
  beforeEach(() => {
    pathname = '/admin/orders'
    mqListeners = []
    mqMatches = false
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return mqMatches
        },
        addEventListener: (_: string, fn: any) => mqListeners.push(fn),
        removeEventListener: (_: string, fn: any) => (mqListeners = mqListeners.filter(l => l !== fn)),
      }))
    )
    document.body.style.overflow = ''
  })

  it('shows the user and role and the QuickScan link', () => {
    mount()
    expect(screen.getByText(/Asha/)).toBeInTheDocument()
    expect(screen.getByText('(owner)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'QuickScan' })).toHaveAttribute('href', '/admin/scan')
  })

  it('renders ungrouped, grouped and pinned links', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin/dashboard')
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Catalog' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens a group containing the active page and keeps others collapsed', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveClass('text-primary-400')
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Products' })).toBeNull()
  })

  it('expands and collapses a group on click', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    expect(screen.getByRole('link', { name: 'Products' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    expect(screen.queryByRole('link', { name: 'Products' })).toBeNull()
  })

  it('treats matchPaths as active', () => {
    pathname = '/admin/returns/55'
    mount()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveClass('text-primary-400')
  })

  it('nested paths activate a link but the dashboard is exact only', () => {
    pathname = '/admin/customers/9'
    mount()
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveClass('text-primary-400')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('text-primary-400')
  })

  it('opens the drawer and locks body scroll, then closes via the backdrop', () => {
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(document.body.style.overflow).toBe('hidden')
    const backdrop = container.querySelector('.bg-black\\/50')!
    expect(backdrop).toHaveClass('opacity-100')
    fireEvent.click(backdrop)
    expect(document.body.style.overflow).toBe('')
    expect(backdrop).toHaveClass('opacity-0')
  })

  it('closes with the X button', () => {
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const panel = container.querySelector('.translate-x-0')!
    expect(panel).toBeInTheDocument()
    fireEvent.click(panel.querySelector('button')!)
    expect(container.querySelector('.-translate-x-full')).toBeInTheDocument()
  })

  it('closes when the viewport grows to desktop width', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(document.body.style.overflow).toBe('hidden')
    act(() => mqListeners.forEach(fn => fn({ matches: true })))
    expect(document.body.style.overflow).toBe('')
  })

  it('strips /admin from links on an admin host', () => {
    mount('admin.shop.test')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: 'QuickScan' })).toHaveAttribute('href', '/scan')
  })

  it('omits the QuickScan entry when there is no scan link', () => {
    render(
      <AdminHostProvider host="shop.test">
        <AdminMobileNav navLinks={[{ href: '/admin/orders', label: 'Orders' }]} username="A" role="r" />
      </AdminHostProvider>
    )
    expect(screen.queryByText('QuickScan')).toBeNull()
  })
})
