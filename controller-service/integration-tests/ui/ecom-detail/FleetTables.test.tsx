import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn<(...a: any[]) => any>(), push: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/t1',
  useSearchParams: () => new URLSearchParams(),
}))

import { ServersTable, PodsTable } from '@controller/components/admin/ecom/detail/FleetTables'
import type { TenantServer } from '@controller/lib/ecom/fleet'

const servers = (): TenantServer[] =>
  [
    { id: 'i-0abc', name: 'acme-web-1', type: 't4g.medium', state: 'running', az: 'ap-south-1a', launchedAt: '2026-11-10T08:00:00Z' },
  ] as unknown as TenantServer[]

const pods = () =>
  [
    { name: 'acme-storefront-xyz', ready: true, phase: 'Running', restarts: 0, node: 'node-1', startedAt: '2026-11-18T08:00:00Z' },
    { name: 'acme-admin-abc', ready: false, phase: 'Pending', restarts: 3, node: null, startedAt: null },
  ]

describe('ServersTable (render + branches)', () => {
  it('renders the empty message with no servers', () => {
    render(<ServersTable servers={[]} />)
    expect(screen.getByText(/No servers of its own/)).toBeInTheDocument()
  })

  it('lists a server with its instance id, type and state', () => {
    render(<ServersTable servers={servers()} />)
    expect(screen.getAllByText('i-0abc').length).toBeGreaterThan(0)
    expect(screen.getAllByText('t4g.medium').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
  })
})

describe('PodsTable (render + branches)', () => {
  it('renders the empty message with no pods', () => {
    render(<PodsTable pods={[]} />)
    expect(screen.getByText('No pods.')).toBeInTheDocument()
  })

  it('shows Ready for a ready pod and the phase for a pending one', () => {
    render(<PodsTable pods={pods() as unknown as Parameters<typeof PodsTable>[0]['pods']} />)
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getAllByText('acme-storefront-xyz').length).toBeGreaterThan(0)
  })
})
