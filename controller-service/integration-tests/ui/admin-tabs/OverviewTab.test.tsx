import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/detail/RunningNow', () => ({ default: () => <div data-testid="running" /> }))
vi.mock('@controller/components/admin/ecom/detail/CostSummary', () => ({ default: () => <div data-testid="cost" /> }))

import OverviewTab, { ServingBanner, Surfaces, ApiOverview, isServing } from '@controller/components/admin/ecom/tabs/OverviewTab'

const tenant = (over: Record<string, unknown> = {}) =>
  ({
    id: 't1', slug: 'acme', status: 'active', instance_state: 'running', rds_endpoint: 'db:5432', plan: 'pro', custom_domain: 'shop.acme.in', monthly_price_inr: 2999, billing_interval: 'monthly',
    daily_payout: true, subscription_status: 'active', created_at: '2026-10-01T00:00:00Z', requested_addons: [], region: 'ap-south-1', ec2_target: '10.0.0.5',
    noreply_email: 'noreply@acme.in', service_types: ['store'], ...over,
  }) as any
const d = (over: Record<string, any> = {}) =>
  ({ t: tenant(over.t), job: { status: 'succeeded', step: 'done', updated_at: '2026-11-10T00:00:00Z' }, isStore: true, spec: { node: { placement: 'dedicated', type: 't4g.small', count: 1 } }, approvals: [], ...over.d }) as any
const owner = { id: 'o1', name: 'Asha Rao', email: 'asha@acme.in', role: 'owner', linked_at: '2026-10-02T00:00:00Z' } as any

describe('OverviewTab (store)', () => {
  it('shows the live banner, plan facts and owners', () => {
    render(<OverviewTab d={d()} owners={[owner]} />)
    expect(screen.getByText('Store is live and backed by its own database.')).toBeInTheDocument()
    expect(screen.getByTestId('running')).toBeInTheDocument()
    expect(screen.getByTestId('cost')).toBeInTheDocument()
    expect(screen.getByText('acme.jeffistores.in', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('shop.acme.in')).toBeInTheDocument()
    expect(screen.getByText('₹2,999/mo')).toBeInTheDocument()
    expect(screen.getByText('Daily (+5%)')).toBeInTheDocument()
    expect(screen.getByText('Provisioned')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('asha@acme.in')).toBeInTheDocument()
  })

  it('names the add-ons chosen at signup', () => {
    render(<OverviewTab d={d({ t: { requested_addons: ['unknown-addon'] } })} owners={[]} />)
    expect(screen.getByText(/unknown-addon \(from the wallet once live\)/)).toBeInTheDocument()
  })

  it('warns when the store is not serving and no owner is linked', () => {
    render(<OverviewTab d={d({ t: { status: 'provisioning', rds_endpoint: null } })} owners={[]} />)
    expect(screen.getByText('Store is not serving customer traffic.')).toBeInTheDocument()
    expect(screen.getByText(/No owner linked to this workspace/)).toBeInTheDocument()
  })
})

describe('Surfaces and ServingBanner', () => {
  it('links hosts only when serving, adding plan-gated hosts', () => {
    render(<Surfaces t={tenant()} />)
    expect(screen.getByRole('link', { name: 'acme.jeffistores.in ↗' })).toHaveAttribute('href', 'https://acme.jeffistores.in')
    expect(screen.getByRole('link', { name: 'quotation-acme.jeffistores.in ↗' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'forms-acme.jeffistores.in ↗' })).toBeInTheDocument()
  })

  it('shows plain text hosts when not serving, without pro-only hosts on a basic plan', () => {
    render(<Surfaces t={tenant({ status: 'suspended', plan: 'basic' })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('invoice-acme.jeffistores.in')).toBeInTheDocument()
    expect(screen.queryByText('forms-acme.jeffistores.in')).toBeNull()
  })

  it('isServing needs both active status and a database', () => {
    expect(isServing(tenant())).toBe(true)
    expect(isServing(tenant({ rds_endpoint: null }))).toBe(false)
    render(<ServingBanner t={tenant({ status: 'suspended' })} />)
    expect(screen.getByText('Store is not serving customer traffic.')).toBeInTheDocument()
  })
})

describe('ApiOverview (workspace without a store)', () => {
  const api = (over: Record<string, unknown> = {}) => tenant({ service_types: ['messaging', 'documents'], ...over })

  it('is what OverviewTab renders when the workspace is not a store', () => {
    render(<OverviewTab d={d({ t: { service_types: ['messaging'] }, d: { isStore: false, approvals: [{ service: 'messaging', status: 'pending' }] } })} owners={[owner]} />)
    expect(screen.getByText('API workspace')).toBeInTheDocument()
    expect(screen.getByText('Messaging API')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.queryByTestId('running')).toBeNull()
  })

  it('treats services without a review row as approved', () => {
    render(<ApiOverview tenant={api()} approvals={[]} />)
    expect(screen.getByText('Documents API')).toBeInTheDocument()
    expect(screen.getAllByText('approved')).toHaveLength(2)
  })

  it('says when no services are enabled', () => {
    render(<ApiOverview tenant={api({ service_types: ['store'] })} approvals={[]} />)
    expect(screen.getByText('No services enabled.')).toBeInTheDocument()
  })
})
