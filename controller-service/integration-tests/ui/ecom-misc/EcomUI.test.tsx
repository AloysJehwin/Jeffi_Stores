import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  EcomHero,
  PlanMixChart,
  StatusPill,
  DetailLink,
  Field,
  Mono,
  Section,
  FieldGrid,
  EcomStatCard,
  TenantTabNav,
  NOT_PROVISIONED,
  isTenantTab,
  TENANT_TABS,
} from '@controller/components/admin/ecom/EcomUI'

// next/link -> anchor so DetailLink / TenantTabNav render real hrefs without a router.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('EcomHero', () => {
  it('renders the headline value, label, tiles and optional note', () => {
    render(
      <EcomHero
        label="Monthly revenue"
        value="₹1,20,000"
        note="estimate"
        tiles={[
          { value: 12, label: 'Stores' },
          { value: '3', label: 'Provisioning' },
        ]}
      />
    )
    expect(screen.getByText('Monthly revenue')).toBeInTheDocument()
    expect(screen.getByText('₹1,20,000')).toBeInTheDocument()
    expect(screen.getByText('estimate')).toBeInTheDocument()
    expect(screen.getByText('Stores')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })
})

describe('PlanMixChart', () => {
  it('shows an empty note when there is no mix', () => {
    render(<PlanMixChart mix={[]} />)
    expect(screen.getByText('No tenants yet.')).toBeInTheDocument()
  })

  it('renders a row per plan with its count', () => {
    render(
      <PlanMixChart
        mix={[
          { plan: 'starter', count: 4 },
          { plan: 'pro', count: 1 },
        ]}
      />
    )
    expect(screen.getByText('starter')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('StatusPill', () => {
  it('uses the default pill map (tenant + money) for a known status', () => {
    render(<StatusPill status="settled" />)
    expect(screen.getByText('Settled')).toBeInTheDocument()
  })

  it('accepts a custom map', () => {
    render(<StatusPill status="x" map={{ x: { label: 'Custom X', tone: 'blue' } }} />)
    expect(screen.getByText('Custom X')).toBeInTheDocument()
  })
})

describe('DetailLink / Field / Mono / Section / FieldGrid', () => {
  it('DetailLink renders an anchor to href', () => {
    render(<DetailLink href="/admin/ecom/customers/1">Open</DetailLink>)
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/ecom/customers/1')
  })

  it('Field renders label and value, dashes a nullish value', () => {
    const { rerender } = render(<Field label="Slug" value="acme" />)
    expect(screen.getByText('Slug')).toBeInTheDocument()
    expect(screen.getByText('acme')).toBeInTheDocument()
    rerender(<Field label="Empty" value={null} />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('Mono renders its children', () => {
    render(<Mono>abc123</Mono>)
    expect(screen.getByText('abc123')).toBeInTheDocument()
  })

  it('Section shows title, optional action and children', () => {
    render(
      <Section title="Infra" action={<button>Act</button>}>
        <p>body</p>
      </Section>
    )
    expect(screen.getByText('Infra')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('FieldGrid renders its children', () => {
    render(
      <FieldGrid>
        <Field label="A" value="1" />
      </FieldGrid>
    )
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('NOT_PROVISIONED is a labelled element', () => {
    render(<div>{NOT_PROVISIONED}</div>)
    expect(screen.getByText('not provisioned')).toBeInTheDocument()
  })
})

describe('EcomStatCard', () => {
  it('renders titled rows with values', () => {
    render(
      <EcomStatCard
        title="Totals"
        note="so far"
        rows={[
          { label: 'Orders', value: 42 },
          { label: 'Revenue', value: '₹5,000', tone: 'text-emerald-500' },
        ]}
      />
    )
    expect(screen.getByText('Totals')).toBeInTheDocument()
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('₹5,000')).toBeInTheDocument()
    expect(screen.getByText('so far')).toBeInTheDocument()
  })
})

describe('TenantTabNav + tab helpers', () => {
  it('renders a link per visible tab, honouring hidden', () => {
    render(<TenantTabNav tenantId="t1" active="overview" hidden={['numbers']} />)
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('href', '/admin/ecom/customers/t1/view?tab=overview')
    expect(screen.getByRole('tab', { name: /Provisioning/ })).toBeInTheDocument()
    // Hidden tab is gone.
    expect(screen.queryByRole('tab', { name: /SMS & WhatsApp numbers/ })).not.toBeInTheDocument()
  })

  it('renders a badge next to a tab', () => {
    render(<TenantTabNav tenantId="t1" active="kyc" badges={{ kyc: <span>1</span> }} />)
    const kyc = screen.getByRole('tab', { name: /KYC/ })
    expect(kyc).toHaveTextContent('1')
  })

  it('isTenantTab validates against TENANT_TABS keys', () => {
    expect(isTenantTab('overview')).toBe(true)
    expect(isTenantTab('nope')).toBe(false)
    expect(isTenantTab(undefined)).toBe(false)
    expect(TENANT_TABS.length).toBeGreaterThan(0)
  })
})
