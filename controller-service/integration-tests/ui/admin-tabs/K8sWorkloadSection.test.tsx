import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/tabs/ComputeRetryButton', () => ({ default: ({ tenantId }: any) => <button type="button">Retry {tenantId}</button> }))
vi.mock('@controller/components/admin/ecom/detail/RunningNow', () => ({ Deployments: () => <div data-testid="deployments" /> }))
vi.mock('@controller/components/admin/ecom/detail/FleetTables', () => ({ PodsTable: ({ pods }: any) => <div data-testid="pods">{pods.length} pods</div> }))

import K8sWorkloadSection from '@controller/components/admin/ecom/tabs/K8sWorkloadSection'

const infra = (over: Record<string, unknown> = {}) =>
  ({
    compute: { status: 'ready', progress: null, last_error: null },
    workload: { ready: 2, desired: 3, image: 'ecr.aws/jeffi/storefront:abc123', pods: [{ name: 'p1' }, { name: 'p2' }] },
    spec: null,
    ...over,
  }) as any
const d = (over: Record<string, unknown> = {}) => ({ t: { id: 't1', slug: 'acme', plan: 'pro' }, fleetKnown: true, ...over }) as any

describe('K8sWorkloadSection', () => {
  it('shows namespace, placement, replicas, image and links for a store on its own server', () => {
    render(<K8sWorkloadSection d={d()} infra={infra()} />)
    expect(screen.getByText('tenant-acme')).toBeInTheDocument()
    expect(screen.getByText('Own t4g.medium')).toBeInTheDocument()
    expect(screen.getByText('2/3 ready')).toBeInTheDocument()
    expect(screen.getByText('storefront:abc123')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Headlamp' })).toHaveAttribute('href', expect.stringContaining('/namespaces/tenant-acme'))
    expect(screen.getByRole('link', { name: 'Coroot' })).toBeInTheDocument()
    expect(screen.getByTestId('deployments')).toBeInTheDocument()
    expect(screen.getByTestId('pods')).toHaveTextContent('2 pods')
  })

  it('shows the shared pool and "Not deployed" when no workload exists', () => {
    render(<K8sWorkloadSection d={d({ t: { id: 't1', slug: 'acme', plan: 'basic' } })} infra={infra({ workload: null, compute: null })} />)
    expect(screen.getByText('Not deployed')).toBeInTheDocument()
    expect(screen.getByText('No compute row yet')).toBeInTheDocument()
    expect(screen.queryByTestId('pods')).toBeNull()
  })

  it('reports an unreachable cluster', () => {
    render(<K8sWorkloadSection d={d()} infra={infra({ workload: undefined })} />)
    expect(screen.getByText('Cluster unreachable')).toBeInTheDocument()
  })

  it('shows the failed compute step with the error and a retry button', () => {
    render(
      <K8sWorkloadSection d={d()} infra={infra({ compute: { status: 'failed', progress: { gen: 2 }, last_error: 'quota exceeded' } })} />,
    )
    expect(screen.getByText(/failed/)).toBeInTheDocument()
    expect(screen.getByText(/\(new servers\): quota exceeded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry t1' })).toBeInTheDocument()
  })

  it('shows a pending plan change and a failed one', () => {
    const { unmount } = render(<K8sWorkloadSection d={d()} infra={infra()} pendingPlan="Pro" />)
    expect(screen.getByText('Applying "Pro"…')).toBeInTheDocument()
    unmount()
    render(<K8sWorkloadSection d={d()} infra={infra()} pendingPlan="Pro" planError="no capacity" />)
    expect(screen.getByText('Not applied (retrying): no capacity')).toBeInTheDocument()
  })

  it('falls back to the fleet-unknown note outside the cluster', () => {
    render(<K8sWorkloadSection d={d({ fleetKnown: false })} infra={infra()} />)
    expect(screen.getByText(/unavailable here/)).toBeInTheDocument()
    expect(screen.queryByTestId('deployments')).toBeNull()
  })
})
