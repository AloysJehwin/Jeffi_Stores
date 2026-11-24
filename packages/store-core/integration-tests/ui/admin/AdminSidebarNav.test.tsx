import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let pathname: string | null = '/admin/orders'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import AdminSidebarNav, { NAV_ICONS } from '@/components/admin/AdminSidebarNav'
import { AdminHostProvider } from '@/contexts/AdminHostContext'

const links = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/orders', label: 'Orders', group: 'Sales', matchPaths: ['/admin/returns'] },
  { href: '/admin/customers', label: 'Customers', group: 'Sales' },
  { href: '/admin/financial', label: 'Financial', group: 'Money' },
  { href: '/admin/financial/upi', label: 'UPI Confirmations', group: 'Money' },
  { href: '/admin/products', label: 'Products', group: 'Catalog' },
  { href: '/admin/custom-thing', label: 'Unmapped link' },
  { href: '/admin/settings', label: 'Settings', bottom: true },
]

function mount(collapsed = false, host = 'shop.test', navLinks = links) {
  return render(
    <AdminHostProvider host={host}>
      <AdminSidebarNav navLinks={navLinks} collapsed={collapsed} />
    </AdminHostProvider>
  )
}

describe('AdminSidebarNav expanded', () => {
  beforeEach(() => {
    pathname = '/admin/orders'
  })

  it('renders ungrouped links, group headers and pinned links with admin hrefs', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin/dashboard')
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Money' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings')
    expect(screen.getByRole('link', { name: 'Unmapped link' })).toBeInTheDocument()
  })

  it('opens the group holding the active page and highlights it', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveClass('bg-white/20')
    expect(screen.getByRole('link', { name: 'Customers' })).not.toHaveClass('bg-white/20')
    expect(screen.queryByRole('link', { name: 'Products' })).toBeNull()
  })

  it('expands and collapses another group', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    expect(screen.getByRole('link', { name: 'Products' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }))
    expect(screen.queryByRole('link', { name: 'Products' })).toBeNull()
  })

  it('matchPaths keep a link active on related pages', () => {
    pathname = '/admin/returns/12'
    mount()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveClass('bg-white/20')
  })

  it('a deeper sibling takes the highlight from its parent', () => {
    pathname = '/admin/financial/upi'
    mount()
    expect(screen.getByRole('link', { name: 'UPI Confirmations' })).toHaveClass('bg-white/20')
    expect(screen.getByRole('link', { name: 'Financial' })).not.toHaveClass('bg-white/20')
  })

  it('a nested page highlights its section but the dashboard is exact only', () => {
    pathname = '/admin/dashboard/extra'
    mount()
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveClass('bg-white/20')
    pathname = '/admin/customers/5/view'
    mount()
    expect(screen.getAllByRole('link', { name: 'Customers' }).at(-1)).toHaveClass('bg-white/20')
  })

  it('opens a group when navigation moves into it', () => {
    pathname = '/admin/dashboard'
    const { rerender } = mount()
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull()
    pathname = '/admin/orders'
    rerender(
      <AdminHostProvider host="shop.test">
        <AdminSidebarNav navLinks={links} collapsed={false} />
      </AdminHostProvider>
    )
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument()
  })

  it('marks the pinned link active', () => {
    pathname = '/admin/settings'
    mount()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass('bg-white/20')
  })

  it('strips /admin on an admin host', () => {
    mount(false, 'admin.shop.test')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
  })

  it('has an icon for every known label and a fallback for unknown ones', () => {
    expect(Object.keys(NAV_ICONS).length).toBeGreaterThan(50)
    const { container } = mount()
    expect(container.querySelectorAll('a svg').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Unmapped link' }).querySelector('svg')).not.toBeNull()
  })

  it('omits the pinned section when nothing is pinned', () => {
    mount(false, 'shop.test', links.filter(l => !l.bottom))
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })
})

describe('AdminSidebarNav collapsed', () => {
  beforeEach(() => {
    pathname = '/admin/orders'
  })

  it('renders icon-only links titled by label, with abbreviated group headers', () => {
    mount(true)
    expect(screen.getByTitle('Dashboard')).toHaveAttribute('href', '/admin/dashboard')
    expect(screen.getByTitle('Orders')).toHaveClass('bg-white/20')
    expect(screen.getByTitle('Customers')).toBeInTheDocument()
    expect(screen.getByText('Sal')).toBeInTheDocument()
    expect(screen.getByText('Mon')).toBeInTheDocument()
    expect(screen.getByTitle('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Orders')).toBeNull()
  })

  it('omits the pinned footer without pinned links', () => {
    mount(true, 'shop.test', links.filter(l => !l.bottom))
    expect(screen.queryByTitle('Settings')).toBeNull()
  })
})
