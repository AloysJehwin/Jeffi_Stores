import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo' } }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

// The hook owns the realtime channel; drive the component from a plain state object.
let chat: any
const hookArgs = vi.fn()
vi.mock('@/components/chat/useSupportChat', () => ({
  useSupportChat: (o: any) => {
    hookArgs(o)
    return chat
  },
}))

import SupportChat from '@/components/visitor/SupportChat'

const fetchMock = vi.fn()
const mkChat = (over: Record<string, any> = {}) => ({
  messages: [],
  session: null,
  setSession: vi.fn(),
  lang: 'en',
  me: null,
  loading: false,
  error: null,
  typing: null,
  send: vi.fn(),
  retry: vi.fn(),
  decide: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn(),
  notifyTyping: vi.fn(),
  setLanguage: vi.fn(),
  reload: vi.fn(),
  ...over,
})
const session = (over: Record<string, any> = {}) => ({ id: 's1', status: 'open', handler: 'ai', ticket: null, customerLang: 'en', ...over })
const msg = (over: Record<string, any>) => ({ id: 'm1', sessionId: 's1', sender: 'ai', senderName: null, text: '', original: null, lang: 'en', at: '2026-01-01T00:00:00Z', status: 'sent', channel: 'web', payloads: [], attachments: [], clientId: null, ...over })
const res = (data: any, ok = true) => ({ ok, json: async () => data })

describe('SupportChat', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    hookArgs.mockReset()
    showToast.mockReset()
    chat = mkChat()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('looks for an existing chat on mount and shows the welcome screen with starters when none', async () => {
    fetchMock.mockResolvedValue(res({}))
    render(<SupportChat />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Hi! How can we help?')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/support/sessions?v=2')
    expect(screen.getByText('Halo Assistant')).toBeInTheDocument()
    expect(screen.getByText('Replies instantly · a person can join anytime')).toBeInTheDocument()
    for (const label of ['Where is my order?', 'Cancel an order', 'Return or refund', 'Change delivery address', 'Payment issue', 'Talk to a person']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'End chat' })).not.toBeInTheDocument()
  })

  it('resumes an existing session and passes it to the chat hook', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session(), messages: [msg({ sender: 'customer', text: 'Hello there' })] })
    render(<SupportChat />)
    await waitFor(() => expect(hookArgs).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 's1', role: 'customer', portal: null })))
    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End chat' })).toBeInTheDocument()
  })

  it('sends the business portal header and links orders under /business', async () => {
    fetchMock.mockResolvedValue(res({}))
    render(<SupportChat portalHeader="business" />)
    await screen.findByText('Hi! How can we help?')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Auth-Portal': 'business' })
    expect(hookArgs).toHaveBeenLastCalledWith(expect.objectContaining({ portal: 'business' }))
  })

  it('a starter creates a chat then sends the first message once it has loaded', async () => {
    fetchMock.mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ session: { id: 's9' } }))
    const { rerender } = render(<SupportChat />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel an order' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const post = fetchMock.mock.calls[1]
    expect(post[1].method).toBe('POST')
    expect(JSON.parse(post[1].body)).toHaveProperty('lang')
    // the hook now reports the new session
    chat = mkChat({ session: session({ id: 's9' }) })
    rerender(<SupportChat />)
    await waitFor(() => expect(chat.send).toHaveBeenCalledWith('I want to cancel an order', []))
  })

  it('toasts when a chat cannot be started', async () => {
    fetchMock.mockResolvedValueOnce(res({})).mockResolvedValueOnce(res({ error: 'Chat is paused' }, false))
    render(<SupportChat />)
    fireEvent.click(await screen.findByRole('button', { name: 'Payment issue' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Chat is paused', 'error'))
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('typing a message in an active chat sends it through the hook', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session() })
    render(<SupportChat />)
    const box = await screen.findByPlaceholderText('Type your message')
    await waitFor(() => expect(box).toBeEnabled())
    fireEvent.change(box, { target: { value: 'Where is it' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(chat.send).toHaveBeenCalledWith('Where is it', [])
  })

  it('shows the human agent, online state and the ticket', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session({ handler: 'human', adminName: 'Priya', adminLastSeenAt: new Date().toISOString(), ticket: 'T-42' }) })
    render(<SupportChat />)
    expect(await screen.findByText('Priya')).toBeInTheDocument()
    expect(screen.getByText('Online · T-42')).toBeInTheDocument()
  })

  it('says a specialist will join when a human is assigned but nobody has picked it up', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session({ handler: 'human', adminName: null }) })
    render(<SupportChat />)
    expect(await screen.findByText('Halo Support')).toBeInTheDocument()
    expect(screen.getByText('A support specialist will join shortly')).toBeInTheDocument()
  })

  it('shows typing, hook errors, and the typing label for the agent', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session(), error: 'Connection lost', typing: { who: 'admin', name: 'Priya' } })
    render(<SupportChat />)
    expect(await screen.findByText('Connection lost')).toBeInTheDocument()
    expect(screen.getByText(/Priya is typing/)).toBeInTheDocument()
  })

  it('end chat: asks to confirm, can be cancelled, and closes the session via PATCH', async () => {
    fetchMock.mockResolvedValue(res({ session: { id: 's1' } }))
    chat = mkChat({ session: session() })
    render(<SupportChat />)
    fireEvent.click(await screen.findByRole('button', { name: 'End chat' }))
    expect(screen.getByText('End this chat?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep chatting' }))
    expect(screen.queryByText('End this chat?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'End chat' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'End chat' }).at(-1)!)
    await waitFor(() => expect(chat.setSession).toHaveBeenCalled())
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/support/sessions/s1')
    expect(JSON.parse(patch[1].body)).toEqual({ status: 'closed' })
    const updater = chat.setSession.mock.calls[0][0]
    expect(updater({ id: 's1', status: 'open' })).toEqual({ id: 's1', status: 'closed' })
    expect(updater(null)).toBeNull()
  })

  it('a closed chat shows the ended notice, no End button, and writing starts a new chat', async () => {
    fetchMock.mockResolvedValueOnce(res({ session: { id: 's1' } })).mockResolvedValueOnce(res({ session: { id: 's2' } }))
    chat = mkChat({ session: session({ status: 'closed' }), messages: [msg({ sender: 'ai', senderName: 'Assistant', text: 'Bye' })] })
    render(<SupportChat />)
    expect(await screen.findByText('Chat ended')).toBeInTheDocument()
    expect(screen.getByText('This chat has ended. Write below to start a new one.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End chat' })).not.toBeInTheDocument()
    const box = screen.getByPlaceholderText('Start a new chat…')
    await waitFor(() => expect(box).toBeEnabled())
    fireEvent.change(box, { target: { value: 'Another question' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(chat.send).not.toHaveBeenCalled()
  })
})
