import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))
vi.mock('@/components/admin/kit/draft-lock', () => ({
  DraftLockBadge: ({ lock }: any) => (lock ? <span>lock:{lock.by}</span> : null),
}))
vi.mock('@/components/admin/drafts/MergeDialog', () => ({
  default: ({ conflicts, onClose, onDone }: any) => (
    <div data-testid="merge">
      {conflicts.length} conflicts
      <button onClick={onClose}>close-merge</button>
      <button onClick={onDone}>done-merge</button>
    </div>
  ),
}))

import DraftRowActions from '@/components/admin/DraftRowActions'

const base = {
  entityId: 'e1',
  name: 'Winter sale',
  subtitle: 'SKU-1',
  updatedAt: '2026-03-04T10:00:00Z',
  editHref: '/admin/coupons/e1/edit',
  publishPath: '/api/admin/coupons/e1/publish',
  discardPath: '/api/admin/coupons/e1/draft',
}
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('DraftRowActions', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    confirm.mockResolvedValue(true)
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(res(200, {}))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('renders the name, subtitle, edit link and date', () => {
    render(<DraftRowActions {...base} />)
    expect(screen.getByText('Winter sale')).toBeInTheDocument()
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/coupons/e1/edit')
    expect(screen.getByText(/4 Mar/)).toBeInTheDocument()
  })

  it('confirms, publishes with POST and refreshes', async () => {
    render(<DraftRowActions {...base} entityLabel="coupon" />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Publish', message: expect.stringContaining('live coupon') }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/coupons/e1/publish', expect.objectContaining({ method: 'POST' }))
  })

  it('sends a JSON body with a custom publish method', async () => {
    render(<DraftRowActions {...base} publishMethod="PATCH" publishBody={{ active: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ active: true })
  })

  it('does nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false)
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the publish error from the API', async () => {
    fetchMock.mockResolvedValue(res(500, { error: 'Boom' }))
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shows a network error when publish throws', async () => {
    fetchMock.mockRejectedValue(new Error('x'))
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })

  it('opens the merge dialog on a draft conflict and refreshes when done', async () => {
    fetchMock.mockResolvedValue(res(409, { code: 'DRAFT_CONFLICT', conflicts: [{}, {}] }))
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByTestId('merge')).toHaveTextContent('2 conflicts')
    fireEvent.click(screen.getByText('done-merge'))
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByTestId('merge')).toBeNull()
  })

  it('discards with a danger confirm and DELETE', async () => {
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger', confirmLabel: 'Discard' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/coupons/e1/draft', expect.objectContaining({ method: 'DELETE' }))
  })

  it('shows the discard error', async () => {
    fetchMock.mockResolvedValue(res(400, {}))
    render(<DraftRowActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Discard failed')).toBeInTheDocument()
  })

  it('hides Publish while another admin holds the lock but still allows Discard', () => {
    render(<DraftRowActions {...base} lock={{ by: 'Ravi', mine: false } as any} />)
    expect(screen.getByText('lock:Ravi')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('shows Publish when the lock is mine', () => {
    render(<DraftRowActions {...base} lock={{ by: 'Me', mine: true } as any} />)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('hides both actions without write permission', () => {
    canWrite = false
    render(<DraftRowActions {...base} />)
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
  })
})
