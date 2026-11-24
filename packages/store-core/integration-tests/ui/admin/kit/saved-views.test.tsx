import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/admin/orders',
}))
const apiMock = vi.fn()
vi.mock('@/components/admin/kit/core', () => ({ api: (...a: any[]) => apiMock(...a) }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/components/admin/kit/toast', () => ({ useActionToast: () => toast }))
let confirmResult = true
let promptResult: string | null = 'My view'
vi.mock('@/contexts/ConfirmContext', () => ({
  useConfirm: () => () => Promise.resolve(confirmResult),
  usePrompt: () => () => Promise.resolve(promptResult),
}))

import { SavedViewsMenu, ShareFilterLink, ExportRowsButton, viewQueryOf } from '@/components/admin/kit/saved-views'

const fields: any[] = [
  { name: 'status', label: 'Status', type: 'select', options: [{ value: 'paid', label: 'Paid' }] },
]
const views = [
  { id: 'v1', name: 'Paid orders', query: 'status=paid', isShared: false, mine: true, ownerName: null },
  { id: 'v2', name: 'Team view', query: 'status=pending', isShared: true, mine: false, ownerName: 'Priya' },
]

beforeEach(() => {
  search = ''
  push.mockClear()
  apiMock.mockReset()
  Object.values(toast).forEach(f => f.mockClear())
  confirmResult = true
  promptResult = 'My view'
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})
afterEach(() => {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
})

describe('viewQueryOf', () => {
  it('keeps the list filters and the sort, drops page and tab', () => {
    const q = viewQueryOf(new URLSearchParams('status=paid&sort=total&dir=asc&page=3&tab=x'), fields)
    expect(new URLSearchParams(q).get('status')).toBe('paid')
    expect(new URLSearchParams(q).get('sort')).toBe('total')
    expect(new URLSearchParams(q).get('dir')).toBe('asc')
    expect(new URLSearchParams(q).get('page')).toBeNull()
    expect(new URLSearchParams(q).get('tab')).toBeNull()
  })
})

describe('SavedViewsMenu', () => {
  function open() {
    render(<SavedViewsMenu entity="orders" fields={fields} tab="all" />)
    fireEvent.click(screen.getByRole('button', { name: /Views/ }))
  }

  it('lists my views and shared views with owner', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: true } })
    open()
    expect(await screen.findByText('Paid orders')).toBeInTheDocument()
    expect(screen.getByText('My views')).toBeInTheDocument()
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.getByText('by Priya')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/saved-views?page=orders')
  })

  it('shows the empty message when there are no views', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views: [], canShare: false } })
    open()
    expect(await screen.findByText(/No saved views yet/)).toBeInTheDocument()
  })

  it('treats a failed load as no views', async () => {
    apiMock.mockRejectedValue(new Error('x'))
    open()
    expect(await screen.findByText(/No saved views yet/)).toBeInTheDocument()
  })

  it('applying a view navigates with the tab first', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    open()
    fireEvent.click(await screen.findByText('Paid orders'))
    expect(push).toHaveBeenCalledWith('/admin/orders?tab=all&status=paid')
  })

  it('saving needs current filters, prompts for a name and posts it', async () => {
    search = 'status=paid'
    apiMock.mockResolvedValue({ ok: true, data: { views: [], canShare: false } })
    open()
    await screen.findByText(/No saved views yet/)
    apiMock.mockClear()
    apiMock.mockResolvedValue({ ok: true, data: { views: [], canShare: false } })
    fireEvent.click(screen.getByRole('button', { name: /Save current filters as a view/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved "My view"'))
    const post = apiMock.mock.calls.find(c => c[0] === '/api/admin/saved-views')!
    expect(post[1]).toMatchObject({ method: 'POST', json: { page: 'orders', name: 'My view', query: 'status=paid' } })
  })

  it('Save is disabled with no filters set', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views: [], canShare: false } })
    open()
    expect(screen.getByRole('button', { name: /Save current filters as a view/ })).toBeDisabled()
  })

  it('deleting asks first and calls DELETE; declining does nothing', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    open()
    await screen.findByText('Paid orders')
    confirmResult = false
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await Promise.resolve()
    expect(apiMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Views/ }))
    confirmResult = true
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('View deleted'))
    expect(apiMock).toHaveBeenCalledWith('/api/admin/saved-views/v1', { method: 'DELETE' })
  })

  it('shows an API error as a toast', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: true } })
    open()
    await screen.findByText('Paid orders')
    apiMock.mockResolvedValue({ ok: false, data: { error: 'Not allowed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Share with the team' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not allowed'))
  })

  it('renaming PATCHes the new name', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    promptResult = 'Renamed'
    open()
    await screen.findByText('Paid orders')
    apiMock.mockClear()
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/admin/saved-views/v1', { method: 'PATCH', json: { name: 'Renamed' } }))
  })

  it('copy link writes the absolute URL with the tab and confirms', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    open()
    await screen.findByText('Paid orders')
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy link' })[0])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copied'))
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toMatch(/\?tab=all&status=paid$/)
  })

  it('names the active view on the button', async () => {
    search = 'status=paid'
    apiMock.mockResolvedValue({ ok: true, data: { views, canShare: false } })
    render(<SavedViewsMenu entity="orders" fields={fields} />)
    expect(await screen.findByRole('button', { name: /Paid orders/ })).toBeInTheDocument()
  })
})

describe('ShareFilterLink', () => {
  it('copies the filtered link to the clipboard', async () => {
    search = 'status=paid&tab=open'
    render(<ShareFilterLink fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share these filters' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link to these filters copied'))
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toMatch(/\?tab=open&status=paid$/)
  })

  it('reports a clipboard failure', async () => {
    ;(navigator.clipboard.writeText as any).mockRejectedValue(new Error('denied'))
    render(<ShareFilterLink fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share these filters' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not copy the link'))
  })

  it('uses the native share sheet on touch devices', async () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<ShareFilterLink fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share these filters' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
})

describe('ExportRowsButton', () => {
  function open() {
    render(<ExportRowsButton entity="orders" fields={fields} noun="Orders" />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
  }

  it('counts the filtered rows first and offers the CSV', async () => {
    search = 'status=paid'
    apiMock.mockResolvedValue({ ok: true, data: { count: 1234, capped: false, cap: 5000 } })
    open()
    expect(screen.getByText('Counting orders…')).toBeInTheDocument()
    expect(await screen.findByText('1,234 orders match these filters.')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/api/admin/filters/orders/export?status=paid&count=1')
    expect(screen.getByRole('button', { name: /Export 1,234 orders \(CSV\)/ })).toBeEnabled()
  })

  it('warns when capped and disables export for zero matches', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { count: 9000, capped: true, cap: 5000 } })
    open()
    expect(await screen.findByText(/Only the first 5,000 are exported/)).toBeInTheDocument()
  })

  it('shows no match and a disabled export for zero rows', async () => {
    apiMock.mockResolvedValue({ ok: true, data: { count: 0, capped: false, cap: 5000 } })
    open()
    expect(await screen.findByText('No orders match these filters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export 0 orders/ })).toBeDisabled()
  })

  it('shows the count error', async () => {
    apiMock.mockResolvedValue({ ok: false, data: { error: 'Too many' } })
    open()
    expect(await screen.findByText('Too many')).toBeInTheDocument()
  })

  it('falls back to a generic error when the count request throws', async () => {
    apiMock.mockRejectedValue(new Error('net'))
    open()
    expect(await screen.findByText('Could not count the rows')).toBeInTheDocument()
  })
})
