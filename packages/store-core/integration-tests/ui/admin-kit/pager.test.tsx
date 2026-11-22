import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pager, type PagerControl } from '@/components/admin/kit/pager'

// useAgentChanges (imported transitively) subscribes to a browser event bus — stub it so Pager,
// a pure prop-driven component, renders without the live-events wiring.
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {}, announceAgentChange: () => {} }))

const base = (over: Partial<PagerControl> = {}): PagerControl => ({
  page: 1,
  pageSize: 10,
  total: 0,
  hasNext: false,
  loading: false,
  setPage: () => {},
  ...over,
})

describe('Pager (render + branches)', () => {
  it('renders nothing on a single, complete page', () => {
    const { container } = render(<Pager control={base({ page: 1, hasNext: false, total: 5 })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the range, total and noun when there is a next page', () => {
    render(<Pager control={base({ page: 2, pageSize: 10, total: 240, hasNext: true })} noun="orders" />)
    expect(screen.getByText('11–20')).toBeInTheDocument()
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText(/orders/)).toBeInTheDocument()
  })

  it('calls setPage(page+1) from the next arrow and disables previous on page 1', () => {
    const setPage = vi.fn<(...a: any[]) => any>()
    render(<Pager control={base({ page: 1, total: 30, hasNext: true, setPage })} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(setPage).toHaveBeenCalledWith(2)
  })

  it('disables the next arrow on the last page', () => {
    render(<Pager control={base({ page: 3, total: 30, hasNext: false, setPage: () => {} })} />)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('renders an error with a Retry that calls retry', () => {
    const retry = vi.fn<(...a: any[]) => any>()
    render(<Pager control={base({ page: 1, hasNext: true, error: 'Boom', retry })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()
  })

  it('disables both arrows while loading', () => {
    render(<Pager control={base({ page: 2, total: 40, hasNext: true, loading: true, setPage: () => {} })} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
})
