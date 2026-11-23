import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineSummary } from '@controller/components/admin/ecom/pipeline/PipelineSummary'
import type { PipelineView } from '@controller/lib/provisioning/pipeline-view'

const pipeline = (o: Partial<PipelineView> = {}): PipelineView => ({
  v: 2,
  status: 'running',
  startedAt: '2026-11-23T10:00:00.000Z',
  finishedAt: null,
  durationMs: 65_000,
  progress: { done: 3, total: 10, skipped: 0, warnings: 0 },
  current: { id: 'create_db', label: 'Create database' },
  jobs: [
    { id: 'infra', label: 'Infra', status: 'success', startedAt: null, durationMs: null, steps: [] as never },
    { id: 'dns', label: 'DNS', status: 'running', startedAt: null, durationMs: null, steps: [] as never },
  ],
  ...o,
})

describe('PipelineSummary (render + branches)', () => {
  it('renders the current step label, progress and duration', () => {
    render(<PipelineSummary pipeline={pipeline()} lastError={null} retryAt={null} />)
    expect(screen.getByText('Create database')).toBeInTheDocument()
    expect(screen.getByText('3 of 10 steps')).toBeInTheDocument()
    expect(screen.getByText('1m 5s')).toBeInTheDocument()
  })

  it('renders an accessible bar segment per job', () => {
    render(<PipelineSummary pipeline={pipeline()} lastError={null} retryAt={null} />)
    expect(screen.getByRole('img', { name: '3 of 10 steps' })).toBeInTheDocument()
  })

  it('shows skipped and pluralised warning counts', () => {
    const p = pipeline({ progress: { done: 5, total: 10, skipped: 2, warnings: 3 } })
    render(<PipelineSummary pipeline={p} lastError={null} retryAt={null} />)
    expect(screen.getByText('2 skipped')).toBeInTheDocument()
    expect(screen.getByText('3 warnings')).toBeInTheDocument()
  })

  it('uses the singular for a single warning', () => {
    const p = pipeline({ progress: { done: 5, total: 10, skipped: 0, warnings: 1 } })
    render(<PipelineSummary pipeline={p} lastError={null} retryAt={null} />)
    expect(screen.getByText('1 warning')).toBeInTheDocument()
  })

  it('renders the last error block when present', () => {
    render(<PipelineSummary pipeline={pipeline()} lastError={'RDS create failed: quota'} retryAt={null} />)
    expect(screen.getByText('RDS create failed: quota')).toBeInTheDocument()
  })

  it('shows a retry line only when the retry time is in the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    render(<PipelineSummary pipeline={pipeline()} lastError={null} retryAt={future} />)
    expect(screen.getByText(/retry at/)).toBeInTheDocument()
  })

  it('omits the retry line for a past retry time', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(<PipelineSummary pipeline={pipeline()} lastError={null} retryAt={past} />)
    expect(screen.queryByText(/retry at/)).not.toBeInTheDocument()
  })
})
