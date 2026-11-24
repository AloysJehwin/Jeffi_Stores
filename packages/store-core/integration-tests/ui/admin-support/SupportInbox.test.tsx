import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Globe, MessageCircle } from 'lucide-react'

vi.mock('@/components/admin/support/SupportConversation', () => ({
  default: ({ sessionId, onClose }: any) => (
    <div data-testid="conversation">
      {sessionId}
      <button onClick={onClose}>close-conv</button>
    </div>
  ),
  CHANNEL_ICON: { web: Globe, app: Globe, whatsapp: MessageCircle, email: Globe },
  CHANNEL_LABEL: { web: 'Website', app: 'App', whatsapp: 'WhatsApp', email: 'Email' },
}))
vi.mock('@/components/chat/PresenceBadge', () => ({ default: () => <i>presence</i> }))

import SupportInbox from '@/components/admin/support/SupportInbox'

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id, channel: 'web', status: 'open', handler: 'ai', assignedAdminId: null, adminName: null, unread: 0, approvals: 0,
  customer: { name: `Cust ${id}` }, createdAt: '2026-03-01T10:00:00Z', lastMessageAt: '2026-03-01T10:00:00Z',
  lastMessage: { sender: 'customer', text: `hello from ${id}`, at: '2026-03-01T10:00:00Z' }, ...over,
})
const list = (sessions: unknown[], counts: Record<string, number> = {}) => ({ ok: true, json: async () => ({ sessions, counts }) })

class FakeES {
  static last: FakeES
  onmessage: ((e: { data: string }) => void) | null = null
  close = vi.fn()
  constructor() { FakeES.last = this }
}

describe('SupportInbox', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeES)
  })

  it('shows a loading state, then conversations with status chips', async () => {
    fetchMock.mockResolvedValue(list([session('a'), session('b', { handler: 'human', assignedAdminId: null }), session('c', { approvals: 2 })], { open: 3, needs_human: 0, approval: 1 }))
    render(<SupportInbox me="admin1" initialFilter="open" />)
    expect(await screen.findByText('Cust a')).toBeInTheDocument()
    expect(screen.getByText('hello from a')).toBeInTheDocument()
    expect(screen.getAllByText('Needs a person').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Needs approval').length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/support/sessions?filter=open')
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(list([]))
    render(<SupportInbox me={null} initialFilter="open" />)
    expect(await screen.findByText('Nothing here right now.')).toBeInTheDocument()
    expect(screen.getByText(/Pick a conversation/)).toBeInTheDocument()
  })

  it('opens a conversation, writes it to the URL, and closes it', async () => {
    fetchMock.mockResolvedValue(list([session('a', { unread: 3 })], { open: 1 }))
    render(<SupportInbox me="admin1" initialFilter="open" />)
    fireEvent.click(await screen.findByText('Cust a'))
    expect(screen.getByTestId('conversation')).toHaveTextContent('a')
    expect(window.location.search).toContain('s=a')
    fireEvent.click(screen.getByText('close-conv'))
    expect(screen.queryByTestId('conversation')).not.toBeInTheDocument()
    expect(window.location.search).not.toContain('s=a')
  })

  it('refetches with the filter, channel and search', async () => {
    fetchMock.mockResolvedValue(list([session('a')], { open: 1 }))
    render(<SupportInbox me="admin1" initialFilter="open" />)
    await screen.findByText('Cust a')
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0].includes('filter=closed'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0].includes('channel=whatsapp'))).toBe(true))
    fireEvent.change(screen.getByPlaceholderText(/Search name, phone/), { target: { value: 'priya' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0].includes('q=priya'))).toBe(true), { timeout: 2000 })
  })

  it('bumps the unread count from a live customer message', async () => {
    fetchMock.mockResolvedValue(list([session('a')], { open: 1 }))
    render(<SupportInbox me="admin1" initialFilter="open" />)
    await screen.findByText('Cust a')
    act(() => FakeES.last.onmessage!({ data: JSON.stringify({ kind: 'message', sessionId: 'a', message: { sender: 'customer', text: 'new!', at: '2026-03-01T11:00:00Z', kind: 'text' } }) }))
    expect(await screen.findByText('new!')).toBeInTheDocument()
    expect(document.querySelector('.min-w-\\[18px\\]')).toHaveTextContent('1')
  })
})
