import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TenantObjectHeader from '@controller/components/admin/ecom/TenantObjectHeader'
import type { TenantDetailData } from '@controller/lib/ecom/detail'

// A non-async server component that composes DetailHeader + the detail KPIs/actions. We mock the kit
// DetailHeader to a plain layout (the real one needs scope/confirm providers) and mock the three
// child widgets so this test is only about WHAT the header wires up for store vs workspace vs purgeable.
vi.mock('@/components/admin/kit/actions', () => ({
  DetailHeader: ({ title, subtitle, status, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="status">{status}</div>
      <div data-testid="subtitle">{subtitle}</div>
      <div data-testid="actions">{actions}</div>
    </div>
  ),
}))
vi.mock('@controller/components/admin/ecom/detail/KpiStrip', () => ({ default: () => <div data-testid="kpis" /> }))
vi.mock('@controller/components/admin/ecom/TenantActions', () => ({ default: () => <div data-testid="tenant-actions" /> }))
vi.mock('@controller/components/admin/ecom/PurgeCustomerButton', () => ({ default: () => <div data-testid="purge" /> }))

const back = { href: '/admin/ecom/customers', label: 'Stores' }

const data = (over: Record<string, any> = {}): TenantDetailData => {
  const { t: tOver, ...rest } = over
  return {
    t: {
      id: 'tnt_1',
      slug: 'acme',
      display_name: 'Acme Co',
      status: 'active',
      instance_state: 'running',
      custom_domain: null,
      service_types: ['store'],
      ...(tOver as any),
    },
    isStore: true,
    job: null,
    kycPending: false,
    purgeable: false,
    ...rest,
  } as unknown as TenantDetailData
}

describe('TenantObjectHeader', () => {
  it('renders the store title and host subtitle', () => {
    render(<TenantObjectHeader d={data()} back={back} section="store" />)
    expect(screen.getByRole('heading', { name: 'Acme Co' })).toBeInTheDocument()
    expect(screen.getByTestId('subtitle')).toHaveTextContent('acme.jeffistores.in')
    expect(screen.getByTestId('kpis')).toBeInTheDocument()
  })

  it('wires TenantActions for a store and no purge when not purgeable', () => {
    render(<TenantObjectHeader d={data({ isStore: true, purgeable: false })} back={back} section="store" />)
    expect(screen.getByTestId('tenant-actions')).toBeInTheDocument()
    expect(screen.queryByTestId('purge')).not.toBeInTheDocument()
  })

  it('shows the purge button when purgeable', () => {
    render(<TenantObjectHeader d={data({ purgeable: true })} back={back} section="store" />)
    expect(screen.getByTestId('purge')).toBeInTheDocument()
  })

  it('shows a Review pending badge when KYC is pending', () => {
    render(<TenantObjectHeader d={data({ kycPending: true })} back={back} section="store" />)
    expect(screen.getByText('Review pending')).toBeInTheDocument()
  })

  it('renders the API-workspace subtitle (no store) and no TenantActions', () => {
    render(
      <TenantObjectHeader
        d={data({ isStore: false, t: { service_types: ['messaging'] } })}
        back={back}
        section="store"
      />
    )
    expect(screen.getByTestId('subtitle')).toHaveTextContent(/API workspace/)
    expect(screen.queryByTestId('tenant-actions')).not.toBeInTheDocument()
  })
})
