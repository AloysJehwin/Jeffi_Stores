import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { StoreCronJobView } from '@controller/lib/cron/store-jobs'
import ScheduledJobs from '@controller/components/admin/ecom/detail/ScheduledJobs'

const jobs = (): StoreCronJobView[] =>
  [
    { id: 'reindex', name: 'Reindex search', interval: 'every hour', last: { status: 'ok', at: '2026-11-20T10:00:00Z', detail: null } },
    { id: 'digest', name: 'Daily digest', interval: 'daily', last: { status: 'failed', at: '2026-11-20T09:00:00Z', detail: 'SMTP timeout' } },
    { id: 'sweep', name: 'Cart sweep', interval: 'every 15m', last: null },
  ] as unknown as StoreCronJobView[]

describe('ScheduledJobs (render + branches)', () => {
  it('renders the empty message with no jobs', () => {
    render(<ScheduledJobs jobs={[]} />)
    expect(screen.getByText(/no scheduled jobs/i)).toBeInTheDocument()
  })

  it('lists jobs, the ok/failing counts and a failed job detail', () => {
    render(<ScheduledJobs jobs={jobs()} />)
    expect(screen.getByText('Reindex search')).toBeInTheDocument()
    expect(screen.getByText('Daily digest')).toBeInTheDocument()
    // failing count surfaced in the header and the summary.
    expect(screen.getAllByText(/1 failing/).length).toBeGreaterThan(0)
    // detail shown only for the non-ok run.
    expect(screen.getByText('SMTP timeout')).toBeInTheDocument()
  })

  it('pluralizes the job count in the header', () => {
    render(<ScheduledJobs jobs={jobs()} />)
    expect(screen.getByText(/3 jobs/)).toBeInTheDocument()
  })
})
