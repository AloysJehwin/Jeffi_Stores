import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import KpiStrip from '@controller/components/admin/ecom/detail/KpiStrip'

const store = () =>
  ({
    t: { status: 'active', plan: 'growth', billing_interval: 'monthly', subscription_status: 'active', rds_endpoint: 'db', ec2_target: 'srv', ec2_instance_id: 'i-1', instance_state: 'running', created_at: '2026-01-02T00:00:00Z', service_types: ['store'] },
    job: null,
    cost: { priceMonth: 2000, priceHour: 3.5, awsMonth: 1200, marginMonth: 800, mtdEstimate: 600 },
    row: { price_inr_month: 2500, wallet_balance: 150 },
    fleet: { placement: 'dedicated', pods: { ready: 2, total: 2 } },
    fleetKnown: true,
    serversRunning: 1,
    isStore: true,
    spec: { node: { placement: 'dedicated', type: 't4g.medium', count: 1 } },
    kycPending: false,
    kyc: { status: 'approved' },
  }) as unknown as TenantDetailData

describe('KpiStrip (section branches)', () => {
  it('store section shows plan, price and this-month tiles', () => {
    render(<KpiStrip d={store()} section="store" />)
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Growth')).toBeInTheDocument()
    expect(screen.getByText('₹2,500')).toBeInTheDocument()
    expect(screen.getByText('This month')).toBeInTheDocument()
  })

  it('instance section shows servers and pods read from the cluster', () => {
    render(<KpiStrip d={store()} section="instance" />)
    expect(screen.getByText('Servers')).toBeInTheDocument()
    expect(screen.getByText('1 running')).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('renders the API-workspace variant when it is not a store', () => {
    const d = { ...store(), isStore: false, t: { ...store().t, service_types: ['messaging', 'documents'] } } as unknown as TenantDetailData
    render(<KpiStrip d={d} section="store" />)
    expect(screen.getByText('API workspace')).toBeInTheDocument()
    expect(screen.getByText('Messaging + Documents')).toBeInTheDocument()
  })
})
