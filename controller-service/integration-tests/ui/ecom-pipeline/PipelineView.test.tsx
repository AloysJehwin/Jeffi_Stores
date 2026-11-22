import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PipelineView } from '@controller/components/admin/ecom/pipeline/PipelineView'
import type { PipelineView as PipelineData } from '@controller/lib/provisioning/pipeline-view'

// ActionButton pulls these contexts; stub them so Refresh renders without providers. next/link -> anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

const pipeline: PipelineData = {
  v: 2,
  status: 'success',
  startedAt: '2026-11-23T10:00:00.000Z',
  finishedAt: '2026-11-23T10:05:00.000Z',
  durationMs: 300_000,
  progress: { done: 2, total: 2, skipped: 0, warnings: 0 },
  current: null,
  jobs: [
    {
      id: 'infra',
      label: 'Provision infrastructure',
      status: 'success',
      startedAt: null,
      durationMs: 1200,
      steps: [
        { id: 'create_db', label: 'Create database', status: 'success', startedAt: null, finishedAt: null, durationMs: 600, attempts: 1, detail: null, events: [] },
      ],
    },
    {
      id: 'dns',
      label: 'Configure DNS',
      status: 'success',
      startedAt: null,
      durationMs: 800,
      steps: [
        { id: 'add_records', label: 'Add records', status: 'success', startedAt: null, finishedAt: null, durationMs: 800, attempts: 1, detail: null, events: [] },
      ],
    },
  ],
}

const okJob = {
  id: 'job-1',
  step: 'done',
  status: 'done',
  attempts: 1,
  last_error: null,
  next_attempt_at: null,
  created_resources: { bucket: 'acme-assets' },
  created_at: '2026-11-23T10:00:00.000Z',
  updated_at: '2026-11-23T10:05:00.000Z',
}

const tenant = { id: 't1', slug: 'acme', status: 'live', rds_endpoint: 'db.rds', s3_bucket: 'acme-assets', region: 'ap-south-1' }

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn<(...a: any[]) => any>().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response)
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('PipelineView (async render + branches)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches on mount and renders the job once loaded', async () => {
    const fetchFn = mockFetch({ tenant, job: okJob, pipeline })
    render(<PipelineView tenantId="t1" />)
    // Label renders in both the mobile JobCard rail and the desktop nav/section.
    expect((await screen.findAllByText('Configure DNS')).length).toBeGreaterThan(0)
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/ecom/customers/t1/provisioning', { cache: 'no-store' })
  })

  it('shows the empty-state message when there is no job', async () => {
    mockFetch({ tenant, job: null, pipeline: null })
    render(<PipelineView tenantId="t1" />)
    expect(await screen.findByText(/No provisioning job for this tenant yet/)).toBeInTheDocument()
  })

  it('renders the error box when the API responds not-ok', async () => {
    mockFetch({ error: 'Boom from server' }, false)
    render(<PipelineView tenantId="t1" />)
    expect(await screen.findByText('Boom from server')).toBeInTheDocument()
  })

  it('renders a network-error message when fetch throws', async () => {
    const fn = vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('offline'))
    global.fetch = fn as unknown as typeof fetch
    render(<PipelineView tenantId="t1" />)
    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })

  it('refetches when Refresh is clicked', async () => {
    const fetchFn = mockFetch({ tenant, job: okJob, pipeline })
    render(<PipelineView tenantId="t1" />)
    await screen.findAllByText('Configure DNS')
    const callsBefore = fetchFn.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() => expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('renders the resources panel with the created bucket', async () => {
    mockFetch({ tenant, job: okJob, pipeline })
    render(<PipelineView tenantId="t1" />)
    expect(await screen.findByText('Created resources')).toBeInTheDocument()
    // bucket appears both in the resources dl and the raw JSON.
    expect(screen.getAllByText(/acme-assets/).length).toBeGreaterThan(0)
  })
})
