import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JobCard } from '@controller/components/admin/ecom/pipeline/JobCard'
import type { JobView, StepView } from '@controller/lib/provisioning/pipeline-view'

const step = (o: Partial<StepView> = {}): StepView => ({
  id: 's1',
  label: 'Step',
  status: 'success',
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  attempts: 1,
  detail: null,
  events: [],
  ...o,
})

const job = (o: Partial<JobView> = {}): JobView => ({
  id: 'infra',
  label: 'Provision infrastructure',
  status: 'success',
  startedAt: null,
  durationMs: null,
  steps: [step({ id: 'a', label: 'A', status: 'success' }), step({ id: 'b', label: 'B', status: 'success' })],
  ...o,
})

describe('JobCard (render + accordion)', () => {
  it('renders the job label and finished/total count', () => {
    render(<JobCard job={job()} startIndex={0} />)
    expect(screen.getByText('Provision infrastructure')).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('appends the duration when the job is timed', () => {
    render(<JobCard job={job({ durationMs: 65_000 })} startIndex={0} />)
    expect(screen.getByText(/1m 5s/)).toBeInTheDocument()
  })

  it('is collapsed for a terminal success and its steps are hidden', () => {
    render(<JobCard job={job({ status: 'success' })} startIndex={0} />)
    const toggle = screen.getByRole('button', { name: /Provision infrastructure/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  it('opens on click and reveals the steps', () => {
    render(<JobCard job={job({ status: 'success' })} startIndex={0} />)
    fireEvent.click(screen.getByRole('button', { name: /Provision infrastructure/ }))
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('starts open while running', () => {
    render(<JobCard job={job({ status: 'running' })} startIndex={0} />)
    const toggle = screen.getByRole('button', { name: /Provision infrastructure/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
