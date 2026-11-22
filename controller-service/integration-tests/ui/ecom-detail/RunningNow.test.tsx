import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TenantDetailData } from '@controller/lib/ecom/detail'
import RunningNow from '@controller/components/admin/ecom/detail/RunningNow'

const running = () =>
  ({
    t: { status: 'active', rds_endpoint: 'db:5432', ec2_target: 'srv', ec2_instance_id: 'i-1', instance_state: 'running' },
    job: null,
    spec: { node: { placement: 'dedicated', type: 't4g.medium', count: 1 } },
    fleet: {
      placement: 'dedicated',
      servers: [{ id: 'i-1', state: 'running' }],
      pods: { ready: 3, total: 3 },
      deployments: [
        { name: 'acme-storefront', ready: 1, desired: 1 },
        { name: 'acme-admin', ready: 0, desired: 1 },
      ],
      postgresReady: true,
    },
    fleetKnown: true,
    serversRunning: 1,
  }) as unknown as TenantDetailData

describe('RunningNow (render + branches)', () => {
  it('lists each deployment with its ready/desired state and Postgres', () => {
    render(<RunningNow d={running()} />)
    expect(screen.getByText('acme-storefront')).toBeInTheDocument()
    expect(screen.getByText('1/1 ready')).toBeInTheDocument()
    expect(screen.getByText('0/1 ready')).toBeInTheDocument()
    expect(screen.getByText('Postgres (on the server)')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
  })

  it('shows the fleet-unknown note outside the cluster', () => {
    const d = { ...running(), fleetKnown: false, fleet: null } as unknown as TenantDetailData
    render(<RunningNow d={d} />)
    expect(screen.getByText(/read from the cluster; unavailable here/i)).toBeInTheDocument()
  })

  it('shows the not-deployed note when nothing exists', () => {
    const d = {
      t: { status: 'active', rds_endpoint: null, ec2_target: null, ec2_instance_id: null, instance_state: 'running' },
      job: null,
      spec: { node: { placement: 'pool', type: null, count: 1 } },
      fleet: null,
      fleetKnown: true,
      serversRunning: 0,
    } as unknown as TenantDetailData
    render(<RunningNow d={d} />)
    expect(screen.getByText(/Not deployed yet/)).toBeInTheDocument()
  })
})
