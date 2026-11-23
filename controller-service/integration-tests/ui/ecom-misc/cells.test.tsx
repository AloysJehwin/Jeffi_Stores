import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  inr,
  inrHr,
  bytes,
  dateIN,
  dateTimeIN,
  storeHost,
  TenantStatus,
  StoreCell,
  RunningCell,
  CostCell,
  SpendCell,
  PlacementCell,
  ServersCell,
} from '@controller/components/admin/ecom/cells'
import type { TenantFleet } from '@controller/lib/ecom/fleet'

// Formatters + cells shared by every Ecom Store list/detail page. Pure/server render — no mocks needed.

describe('ecom cells formatters', () => {
  it('inr formats rupees, handles negatives and nullish', () => {
    expect(inr(1500)).toBe('₹1,500')
    expect(inr(-1500)).toBe('−₹1,500')
    expect(inr(null)).toBe('—')
    expect(inr('')).toBe('—')
    expect(inr('abc')).toBe('—')
  })

  it('inrHr appends /h, dashes on nullish', () => {
    expect(inrHr(2)).toBe('₹2.00/h')
    expect(inrHr(null)).toBe('—')
  })

  it('bytes scales units and dashes on zero/null', () => {
    expect(bytes(0)).toBe('—')
    expect(bytes(null)).toBe('—')
    expect(bytes(512)).toBe('512 B')
    expect(bytes(1024)).toBe('1.0 KB')
    expect(bytes(1024 * 1024)).toBe('1.0 MB')
  })

  it('date formatters dash on empty', () => {
    expect(dateIN(null)).toBe('—')
    expect(dateTimeIN(undefined)).toBe('—')
    // Non-empty renders something (locale-dependent), just not the dash.
    expect(dateIN('2026-01-15')).not.toBe('—')
  })

  it('storeHost prefers custom domain, falls back to slug host', () => {
    expect(storeHost({ slug: 'acme', custom_domain: 'shop.acme.com, www.acme.com' })).toBe('shop.acme.com')
    expect(storeHost({ slug: 'acme', custom_domain: null })).toBe('acme.jeffistores.in')
  })
})

describe('TenantStatus', () => {
  it('renders the mapped label for a known status', () => {
    render(<TenantStatus status="active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('humanises an unknown status', () => {
    render(<TenantStatus status="pending_approval" />)
    expect(screen.getByText('Pending approval')).toBeInTheDocument()
  })
})

describe('StoreCell', () => {
  it('shows name, store host and owner email for a store', () => {
    render(
      <StoreCell
        t={{
          display_name: 'Acme Co',
          slug: 'acme',
          custom_domain: null,
          owner_email: 'owner@acme.com',
          isStore: true,
          service_types: ['store'],
        }}
      />
    )
    expect(screen.getByText('Acme Co')).toBeInTheDocument()
    expect(screen.getByText('acme.jeffistores.in')).toBeInTheDocument()
    expect(screen.getByText('owner@acme.com')).toBeInTheDocument()
  })

  it('renders an API workspace line when not a store', () => {
    render(
      <StoreCell
        t={{
          display_name: 'API WS',
          slug: 'ws',
          custom_domain: null,
          owner_email: null,
          isStore: false,
          service_types: ['store', 'messaging', 'documents'],
        }}
      />
    )
    expect(screen.getByText(/API workspace · messaging \+ documents/)).toBeInTheDocument()
  })
})

const fleet = (over: Partial<TenantFleet> = {}): TenantFleet =>
  ({ placement: 'own', pods: { ready: 2, total: 2 }, servers: [{ type: 't4g.medium', state: 'running' }], ...over }) as TenantFleet

describe('RunningCell', () => {
  it('dashes when fleet is unknown', () => {
    render(<RunningCell fleet={null} known={false} servers={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('says nothing running when empty', () => {
    render(<RunningCell fleet={fleet({ pods: { ready: 0, total: 0 } })} known servers={0} />)
    expect(screen.getByText('Nothing running')).toBeInTheDocument()
  })

  it('shows server count and ready pods', () => {
    render(<RunningCell fleet={fleet()} known servers={2} />)
    expect(screen.getByText('2 servers · 2/2 pods')).toBeInTheDocument()
  })

  it('reports the shared pool placement', () => {
    render(<RunningCell fleet={fleet({ placement: 'pool' })} known servers={0} />)
    expect(screen.getByText('shared pool · 2/2 pods')).toBeInTheDocument()
  })
})

describe('CostCell / SpendCell', () => {
  it('CostCell shows price and AWS line', () => {
    render(<CostCell price={999} aws={400} />)
    expect(screen.getByText('₹999/mo')).toBeInTheDocument()
    expect(screen.getByText('AWS ₹400')).toBeInTheDocument()
  })

  it('CostCell dashes a null price and hides AWS when null', () => {
    render(<CostCell price={null} aws={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/AWS/)).not.toBeInTheDocument()
  })

  it('SpendCell shows an estimate, dashes null', () => {
    const { rerender } = render(<SpendCell mtd={250} />)
    expect(screen.getByText('₹250 est.')).toBeInTheDocument()
    rerender(<SpendCell mtd={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('PlacementCell / ServersCell', () => {
  it('PlacementCell dashes unknown, None when no placement, else label', () => {
    const { rerender } = render(<PlacementCell fleet={null} known={false} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<PlacementCell fleet={fleet({ placement: 'pool' })} known />)
    expect(screen.getByText('Shared pool')).toBeInTheDocument()
  })

  it('ServersCell groups server types and lists states', () => {
    render(
      <ServersCell
        fleet={fleet({ servers: [{ type: 't4g.medium', state: 'running' } as never, { type: 't4g.medium', state: 'running' } as never] })}
        known
      />
    )
    expect(screen.getByText('t4g.medium × 2 · running')).toBeInTheDocument()
  })

  it('ServersCell shows Pool / None when empty', () => {
    render(<ServersCell fleet={fleet({ servers: [], placement: 'pool' })} known />)
    expect(screen.getByText('Pool')).toBeInTheDocument()
  })
})
