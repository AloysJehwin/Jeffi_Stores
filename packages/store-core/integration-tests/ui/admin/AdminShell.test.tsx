import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/admin/AdminSidebarNav', () => ({
  default: ({ navLinks, collapsed }: any) => (
    <nav data-testid="sidebar" data-collapsed={String(collapsed)}>
      {navLinks.map((l: any) => l.label).join(',')}
    </nav>
  ),
}))
vi.mock('@/components/admin/AdminMobileNav', () => ({
  default: ({ navLinks, username, role }: any) => (
    <div data-testid="mobile">
      {navLinks.length}:{username}:{role}
    </div>
  ),
}))
vi.mock('@/components/admin/AdminAgentTrigger', () => ({ default: () => <i data-testid="trigger" /> }))
vi.mock('@/components/admin/agent/AgentDock', () => ({ default: () => <i data-testid="dock" /> }))
vi.mock('@/components/admin/NotificationBell', () => ({ default: () => <i data-testid="bell" /> }))
vi.mock('@/components/admin/WalletBadge', () => ({
  default: ({ initialBalance, initialMinBalance }: any) => (
    <i data-testid="wallet">
      {initialBalance}/{initialMinBalance}
    </i>
  ),
}))
vi.mock('@/components/admin/ScanActionPopup', () => ({
  default: ({ role, host }: any) => (
    <i data-testid="scan">
      {role}@{host}
    </i>
  ),
}))
vi.mock('@/components/ThemeToggle', () => ({ default: ({ variant }: any) => <i data-testid="theme">{variant}</i> }))
vi.mock('@/components/admin/AdminSessionController', () => ({ default: () => <i data-testid="session" /> }))
const agentProps = vi.fn()
vi.mock('@/contexts/AdminAgentContext', () => ({
  AdminAgentProvider: ({ children, ...p }: any) => {
    agentProps(p)
    return <>{children}</>
  },
}))

import AdminShell from '@/components/admin/AdminShell'

const base = {
  brandName: 'Acme Store',
  desktopNavLinks: [{ href: '/admin/orders', label: 'Orders' }],
  allNavLinks: [
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/scan', label: 'Scan' },
  ],
  displayName: 'Asha Rao',
  usernameInitial: 'A',
  role: 'owner',
  scopes: ['orders:read'],
  host: 'shop.test',
  canUseAgent: true,
  adminId: 'a1',
  agentDockButton: true,
  logoutForm: <button>Log out</button>,
  initialCollapsed: false,
}

function mount(over: Partial<typeof base & { wallet: any }> = {}) {
  return render(
    <AdminShell {...base} {...over}>
      <p>page body</p>
    </AdminShell>
  )
}

describe('AdminShell', () => {
  beforeEach(() => {
    document.cookie = 'sidebar_collapsed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  it('renders brand, user, role, children and the logout slot', () => {
    mount()
    expect(screen.getAllByText('Acme Store').length).toBeGreaterThan(0)
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('owner')).toBeInTheDocument()
    expect(screen.getByText('page body')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('wires chrome components with the right props', () => {
    mount()
    expect(screen.getByTestId('sidebar')).toHaveTextContent('Orders')
    expect(screen.getByTestId('mobile')).toHaveTextContent('2:Asha Rao:owner')
    expect(screen.getByTestId('scan')).toHaveTextContent('owner@shop.test')
    expect(screen.getByTestId('theme')).toHaveTextContent('admin')
    for (const id of ['bell', 'trigger', 'dock', 'session']) expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(agentProps).toHaveBeenCalledWith({ adminId: 'a1', enabled: true, showButton: true })
  })

  it('shows the wallet badge only when a wallet is provided', () => {
    const first = mount()
    expect(screen.queryByTestId('wallet')).toBeNull()
    first.unmount()
    mount({ wallet: { balance: 900, minBalance: 100 } })
    expect(screen.getByTestId('wallet')).toHaveTextContent('900/100')
  })

  it('toggles the sidebar and persists the choice in a cookie', () => {
    mount()
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    fireEvent.click(screen.getByTitle('Collapse sidebar'))
    expect(sidebar).toHaveAttribute('data-collapsed', 'true')
    expect(document.cookie).toContain('sidebar_collapsed=true')
    fireEvent.click(screen.getByTitle('Expand sidebar'))
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    expect(document.cookie).toContain('sidebar_collapsed=false')
  })

  it('starts collapsed when told to', () => {
    mount({ initialCollapsed: true })
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  })

  it('a stored cookie overrides the initial state after mount', () => {
    document.cookie = 'sidebar_collapsed=true; path=/'
    mount({ initialCollapsed: false })
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  })
})
