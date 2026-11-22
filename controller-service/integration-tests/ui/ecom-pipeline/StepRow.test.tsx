import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepRow } from '@controller/components/admin/ecom/pipeline/StepRow'
import type { StepView, EventView } from '@controller/lib/provisioning/pipeline-view'

// next/link -> plain anchor so the certificate link renders without the Next runtime.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ev = (o: Partial<EventView> = {}): EventView => ({
  status: 'ok',
  message: null,
  detail: {},
  started_at: null,
  duration_ms: null,
  created_at: '2026-11-23T10:00:00.000Z',
  ...o,
})

const step = (o: Partial<StepView> = {}): StepView => ({
  id: 'create_db',
  label: 'Create database',
  status: 'success',
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  attempts: 1,
  detail: null,
  events: [],
  ...o,
})

describe('StepRow (render + branches)', () => {
  it('renders the label and the 1-based index', () => {
    render(<StepRow step={step({ label: 'Create database' })} index={2} />)
    expect(screen.getByText('Create database')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the duration when timed', () => {
    render(<StepRow step={step({ durationMs: 1500 })} index={0} />)
    expect(screen.getByText('1.5s')).toBeInTheDocument()
  })

  it('disables the toggle when there is no log', () => {
    render(<StepRow step={step({ events: [], detail: null })} index={0} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('expands the log on click when events exist', () => {
    const s = step({ events: [ev({ status: 'ok', message: 'provisioned ok' })] })
    render(<StepRow step={s} index={0} />)
    const btn = screen.getByRole('button')
    expect(btn).not.toBeDisabled()
    expect(screen.queryByText('provisioned ok')).not.toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.getByText('provisioned ok')).toBeInTheDocument()
    // The step id is printed in the expanded log.
    expect(screen.getByText('create_db')).toBeInTheDocument()
  })

  it('auto-opens a failed step and counts retries', () => {
    const s = step({
      status: 'failed',
      events: [ev({ status: 'error', message: 'boom' }), ev({ status: 'error', message: 'boom again' })],
    })
    render(<StepRow step={s} index={0} />)
    // Failed starts expanded, so the error message is visible without a click.
    expect(screen.getByText('boom again')).toBeInTheDocument()
    expect(screen.getByText('2 retries')).toBeInTheDocument()
  })

  it('renders the certificate hint for the warning on issue_owner_certificate', () => {
    const s = step({ id: 'issue_owner_certificate', status: 'warning', label: 'Issue certificate' })
    render(<StepRow step={s} index={0} certificatesHref="/admin/ecom/customers/t1/view?tab=certificates" />)
    const link = screen.getByRole('link', { name: /Issue it from Certificates/ })
    expect(link).toHaveAttribute('href', '/admin/ecom/customers/t1/view?tab=certificates')
  })

  it('renders the step detail line for a non-failed step', () => {
    render(<StepRow step={step({ status: 'running', detail: 'waiting for RDS' })} index={0} />)
    expect(screen.getByText('waiting for RDS')).toBeInTheDocument()
  })
})
