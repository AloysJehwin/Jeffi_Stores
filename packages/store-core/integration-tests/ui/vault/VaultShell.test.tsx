import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// VaultShell is the vault chrome: sticky bar with store identity, a Library nav link, a search box
// (shared via context) and an account menu. It reads the route via next/navigation, which we mock.
const push = vi.fn()
let pathname = '/library'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}))

import VaultShell from '@/components/vault/VaultShell'

beforeEach(() => {
  push.mockClear()
  pathname = '/library'
})

const base = {
  storeName: 'Halo Audio',
  logoUrl: null,
  storeUrl: 'https://shop.test/',
  buyer: { name: 'Asha Rao', email: 'asha@test.in' },
}

describe('VaultShell (render + interaction)', () => {
  it('renders the store name, the Vault badge and the search box', () => {
    render(<VaultShell {...base}>content</VaultShell>)
    expect(screen.getAllByText('Halo Audio').length).toBeGreaterThan(0)
    expect(screen.getByText('Vault')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search your library/ })).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('marks the Library link as the current page on the library route', () => {
    render(<VaultShell {...base}>x</VaultShell>)
    const current = screen.getAllByRole('link', { name: /Library/ }).find(l => l.getAttribute('aria-current') === 'page')
    expect(current).toBeTruthy()
  })

  it('opens the account menu and shows the buyer identity', () => {
    render(<VaultShell {...base}>x</VaultShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0)
    expect(screen.getAllByText('asha@test.in').length).toBeGreaterThan(0)
    // Signed-in buyer gets a Sign out action.
    expect(screen.getAllByRole('menuitem', { name: /Sign out/ }).length).toBeGreaterThan(0)
  })

  it('shows "Not signed in" and no sign-out for an anonymous buyer', () => {
    render(<VaultShell {...base} buyer={null}>x</VaultShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    // Menu renders in both the desktop dropdown and the mobile sheet.
    expect(screen.getAllByText('Not signed in').length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: /Sign out/ })).not.toBeInTheDocument()
  })

  it('pushes the query to /library when searching from a non-library route', () => {
    pathname = '/item/p1'
    render(<VaultShell {...base}>x</VaultShell>)
    const input = screen.getByRole('searchbox', { name: /Search your library/ })
    fireEvent.change(input, { target: { value: 'jazz' } })
    fireEvent.submit(input.closest('form')!)
    expect(push).toHaveBeenCalledWith('/library?q=jazz')
  })
})
