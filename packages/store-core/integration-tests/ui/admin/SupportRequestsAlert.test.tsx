import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))
vi.mock('@/components/chat/format', () => ({ ago: () => '5m' }))

import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'

const session = (o: Record<string, any> = {}) => ({
  id: 's1', createdAt: '2026-11-20T10:00:00Z', handoffAt: '2026-11-20T10:05:00Z', handoffReason: 'Refund dispute',
  customer: { name: 'Asha Rao', email: 'a@x.in', phone: null }, lastMessage: { text: 'hello' }, ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => vi.useRealTimers())

describe('SupportRequestsAlert', () => {
  it('renders nothing while there are no waiting chats', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) })
    const { container } = render(<SupportRequestsAlert />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/support/sessions?filter=needs_human&limit=8'))
    expect(container.firstChild).toBeNull()
  })

  it('lists waiting customers with count, reason, wait time and links', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sessions: [session(), session({ id: 's2', handoffReason: null, customer: { name: 'Ravi', email: null, phone: '999' } })] }) })
    render(<SupportRequestsAlert />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('Refund dispute')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting 5m')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Open inbox' })).toHaveAttribute('href', '/admin/support')
    expect(screen.getByText('Ravi').closest('a')).toHaveAttribute('href', '/admin/support?s=s2')
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('stays empty on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { container } = render(<SupportRequestsAlert />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('polls again every 15 seconds', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) })
    render(<SupportRequestsAlert />)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
