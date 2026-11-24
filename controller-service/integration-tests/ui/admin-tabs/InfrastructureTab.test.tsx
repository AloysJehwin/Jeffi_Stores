import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@controller/components/admin/ecom/tabs/K8sWorkloadSection', () => ({ default: (p: any) => <div data-testid="k8s">{p.pendingPlan ?? '-'}|{p.planError ?? '-'}</div> }))
vi.mock('@controller/components/admin/ecom/detail/CostBreakdown', () => ({ default: () => <div data-testid="cost" /> }))
vi.mock('@controller/components/admin/ecom/detail/DnsResyncButton', () => ({
  default: (p: any) => (
    <button type="button" disabled={p.disabled}>
      Re-sync DNS
    </button>
  ),
}))
vi.mock('@controller/components/admin/ecom/detail/FleetTables', () => ({ ServersTable: ({ servers }: any) => <div data-testid="servers">{servers.length} servers</div> }))

import InfrastructureTab from '@controller/components/admin/ecom/tabs/InfrastructureTab'

const spec = { db: { mode: 'dedicated', class: 'db.t4g.small', storageGb: 50, multiAz: true }, storage: { s3Gb: 100 }, node: { placement: 'dedicated' } }
const d = (over: Record<string, any> = {}) =>
  ({
    t: {
      id: 't1', status: 'active', instance_state: 'running', plan: 'pro', ec2_target: '10.0.0.5', ec2_instance_id: 'i-0abc', rds_endpoint: 'db.acme.rds:5432', rds_db: 'acme', rds_port: 5432,
      rds_user: 'app_user', iam_auth: true, region: 'ap-south-1', s3_bucket: 'acme-assets', cloudfront_id: 'E123', created_at: '2026-10-01T00:00:00Z', ...over.t,
    },
    job: { created_resources: { dnsHosts: ['acme.jeffistores.in', 'admin-acme.jeffistores.in'], dbInstanceId: 'acme-db', k8sPendingPlan: 'Pro' } },
    fleet: { placement: 'dedicated', servers: [{ id: 'i-0abc' }], postgresReady: true },
    fleetKnown: true,
    row: { s3_usage_bytes: 5 * 1024 * 1024 },
    ...over.d,
  }) as any
const infra = (over: Record<string, unknown> = {}) =>
  ({
    domains: [],
    migrations: [],
    currentSha: 'abcdef1234567890',
    spec,
    ...over,
  }) as any

describe('InfrastructureTab', () => {
  it('shows servers, database, storage and DNS hosts for a deployed store', () => {
    render(<InfrastructureTab d={d()} infra={infra()} />)
    expect(screen.getByTestId('servers')).toHaveTextContent('1 servers')
    expect(screen.getByText('Its own RDS instance')).toBeInTheDocument()
    expect(screen.getByText('db.t4g.small · Multi-AZ · 50 GB')).toBeInTheDocument()
    expect(screen.getByText('RDS automated backups')).toBeInTheDocument()
    expect(screen.getByText('IAM (app_user)')).toBeInTheDocument()
    expect(screen.getByText('100 GB')).toBeInTheDocument()
    expect(screen.getByText('acme.jeffistores.in')).toBeInTheDocument()
    expect(screen.getByText('admin-acme.jeffistores.in')).toBeInTheDocument()
    expect(screen.getByTestId('k8s')).toHaveTextContent('Pro|-')
    expect(screen.getByTestId('cost')).toBeInTheDocument()
  })

  it('explains an empty fleet by placement and by unknown cluster', () => {
    const { unmount } = render(<InfrastructureTab d={d({ d: { fleet: { placement: 'pool', servers: [], postgresReady: null } } })} infra={infra()} />)
    expect(screen.getByText(/Runs on the shared basic pool/)).toBeInTheDocument()
    unmount()
    render(<InfrastructureTab d={d({ d: { fleetKnown: false, fleet: null } })} infra={infra()} />)
    expect(screen.getByText(/unavailable here/)).toBeInTheDocument()
  })

  it('shows a dash for database fields when there is no compute spec', () => {
    render(<InfrastructureTab d={d()} infra={infra({ spec: null })} />)
    expect(screen.queryByText('Its own RDS instance')).toBeNull()
  })

  it('says no DNS records and no custom domain when none exist', () => {
    render(<InfrastructureTab d={d({ d: { job: null } })} infra={infra()} />)
    expect(screen.getByText('No DNS records recorded for this tenant yet.')).toBeInTheDocument()
    expect(screen.getByText(/No custom domain/)).toBeInTheDocument()
  })

  it('disables DNS re-sync for a store that is not active', () => {
    render(<InfrastructureTab d={d({ t: { status: 'suspended' } })} infra={infra()} />)
    expect(screen.getByRole('button', { name: 'Re-sync DNS' })).toBeDisabled()
  })

  it('explains that no migration ran', () => {
    render(<InfrastructureTab d={d()} infra={infra()} />)
    expect(screen.getByText(/No migration has run against this store's database/)).toBeInTheDocument()
  })

  it('marks the schema behind the platform, with the failing run and history', () => {
    const migrations = [
      { git_sha: '1111111111aaaa', status: 'failed', ran_at: '2026-11-20T00:00:00Z', error: 'relation exists' },
      { git_sha: '2222222222bbbb', status: 'success', ran_at: '2026-11-10T00:00:00Z', error: null },
    ]
    render(<InfrastructureTab d={d()} infra={infra({ migrations })} />)
    expect(screen.getByText('Behind')).toBeInTheDocument()
    expect(screen.getByText('1111111111')).toBeInTheDocument()
    expect(screen.getByText('abcdef1234')).toBeInTheDocument()
    expect(screen.getByText('relation exists')).toBeInTheDocument()
    expect(screen.getByText('2222222222')).toBeInTheDocument()
  })

  it('marks the schema current when it matches the platform build', () => {
    render(<InfrastructureTab d={d()} infra={infra({ migrations: [{ git_sha: 'abcdef1234567890', status: 'success', ran_at: '2026-11-20T00:00:00Z', error: null }] })} />)
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
  })

  it('lists custom domains with the verification token while unverified', () => {
    const domains = [
      { id: 'a', domain: 'shop.acme.in', status: 'pending', verification_token: 'tok-123', cert_arn: null, verified_at: null },
      { id: 'b', domain: 'www.acme.in', status: 'verified', verification_token: 'x', cert_arn: 'arn:aws:acm:region:1:certificate/abc-999', verified_at: '2026-11-01T00:00:00Z' },
    ]
    render(<InfrastructureTab d={d()} infra={infra({ domains })} />)
    expect(screen.getByText('shop.acme.in')).toBeInTheDocument()
    expect(screen.getByText('tok-123')).toBeInTheDocument()
    expect(screen.getByText('cert abc-999')).toBeInTheDocument()
    expect(screen.queryByText('x')).toBeNull()
  })
})
