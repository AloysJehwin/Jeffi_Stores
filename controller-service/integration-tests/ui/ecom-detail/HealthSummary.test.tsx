import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import HealthSummary from '@controller/components/admin/ecom/detail/HealthSummary'

const good = () =>
  ({
    t: { status: 'active', rds_endpoint: 'db:5432', instance_state: 'running', ec2_target: 'srv', ec2_instance_id: 'i-1' },
    job: { status: 'succeeded', step: 'done', updated_at: '2026-11-20T10:00:00Z', attempts: 3, last_error: null },
    fleet: { pods: { ready: 2, total: 2 }, postgresReady: true },
    fleetKnown: true,
    row: { compute_status: 'applied' },
  }) as unknown as TenantDetailData

const failed = () =>
  ({
    t: { status: 'suspended', rds_endpoint: 'db:5432', instance_state: 'running', ec2_target: 'srv', ec2_instance_id: 'i-1' },
    job: { status: 'failed', step: 'migrate', updated_at: '2026-11-20T10:00:00Z', attempts: 5, last_error: 'migration 0003 failed: syntax error' },
    fleet: { pods: { ready: 0, total: 2 }, postgresReady: false },
    fleetKnown: true,
    row: { compute_status: 'failed' },
  }) as unknown as TenantDetailData

describe('HealthSummary (render + branches)', () => {
  it('shows the serving headline and health fields when healthy', () => {
    render(<HealthSummary d={good()} />)
    expect(screen.getByText('Serving customers')).toBeInTheDocument()
    expect(screen.getByText('2/2 ready')).toBeInTheDocument()
    expect(screen.getByText('Provisioned')).toBeInTheDocument()
  })

  it('shows the failure headline and the last error on a failed job', () => {
    render(<HealthSummary d={failed()} />)
    expect(screen.getByText('Provisioning failed at migrate')).toBeInTheDocument()
    expect(screen.getByText(/migration 0003 failed/)).toBeInTheDocument()
  })

  it('marks pods unknown outside the cluster', () => {
    const d = { ...good(), fleetKnown: false, fleet: null } as unknown as TenantDetailData
    render(<HealthSummary d={d} />)
    expect(screen.getByText(/cluster only/)).toBeInTheDocument()
  })
})
