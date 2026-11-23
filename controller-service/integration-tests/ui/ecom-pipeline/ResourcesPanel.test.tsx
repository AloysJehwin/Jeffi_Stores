import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResourcesPanel } from '@controller/components/admin/ecom/pipeline/ResourcesPanel'

const tenant = { rds_endpoint: null as string | null, s3_bucket: null as string | null }

describe('ResourcesPanel (render + branches)', () => {
  it('renders created-resource values from the run', () => {
    const res = { endpoint: 'db.example.rds.amazonaws.com', bucket: 'acme-assets', computeMode: 'shared' }
    render(<ResourcesPanel res={res} tenant={tenant} />)
    expect(screen.getByText('db.example.rds.amazonaws.com')).toBeInTheDocument()
    expect(screen.getByText('acme-assets')).toBeInTheDocument()
    expect(screen.getByText('shared')).toBeInTheDocument()
  })

  it('falls back to the tenant endpoint/bucket when the run has none', () => {
    render(<ResourcesPanel res={{}} tenant={{ rds_endpoint: 'fallback.rds', s3_bucket: 'fallback-bucket' }} />)
    expect(screen.getByText('fallback.rds')).toBeInTheDocument()
    expect(screen.getByText('fallback-bucket')).toBeInTheDocument()
  })

  it('renders an em dash for a missing value', () => {
    render(<ResourcesPanel res={{}} tenant={tenant} />)
    // paramGroup is absent and has no fallback -> em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('lists each named server instance', () => {
    const res = { nodeInstances: { web: 'i-111', worker: 'i-222' } }
    render(<ResourcesPanel res={res} tenant={tenant} />)
    // Appears in both the server list and the raw JSON disclosure.
    expect(screen.getAllByText(/i-111/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/i-222/).length).toBeGreaterThan(0)
  })

  it('falls back to a single ec2InstanceId when there are no named servers', () => {
    render(<ResourcesPanel res={{ ec2InstanceId: 'i-single' }} tenant={tenant} />)
    expect(screen.getByText('i-single')).toBeInTheDocument()
  })

  it('lists DNS hosts when provided', () => {
    render(<ResourcesPanel res={{ dnsHosts: ['acme.jeffistores.in', 'www.acme.jeffistores.in'] }} tenant={tenant} />)
    expect(screen.getByText('acme.jeffistores.in')).toBeInTheDocument()
    expect(screen.getByText('www.acme.jeffistores.in')).toBeInTheDocument()
  })

  it('always renders the raw created_resources JSON in a disclosure', () => {
    render(<ResourcesPanel res={{ bucket: 'b1' }} tenant={tenant} />)
    expect(screen.getByText('Raw created_resources')).toBeInTheDocument()
    expect(screen.getByText(/"bucket": "b1"/)).toBeInTheDocument()
  })
})
