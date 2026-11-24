import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { forwardRef } from 'react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let scopes = { write: true, drive: false }
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => scopes.write, useHasScope: () => scopes.drive }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo' } }) }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: () => <i>ai-enrich</i> }))
vi.mock('@/components/admin/drive/api', () => ({ driveToAttachment: (x: unknown) => x }))
vi.mock('@/components/admin/drive/DrivePicker', () => ({ useDrivePicker: () => ({ pick: vi.fn(), node: null }) }))
vi.mock('@/components/chat/ChatShell', () => ({
  default: ({ header, banner, composer, children }: any) => (
    <div>
      {header}
      {banner}
      {children}
      {composer}
    </div>
  ),
}))
vi.mock('@/components/chat/Composer', () => ({
  default: forwardRef(function ComposerStub({ notice, placeholder, text, setText, accessory }: any, ref: any) {
    if (ref) ref.current = { focus: vi.fn() }
    return (
      <div>
        {notice && <p>{notice}</p>}
        <input aria-label="composer" placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} />
        {accessory}
      </div>
    )
  }),
}))
vi.mock('@/components/chat/LanguagePicker', () => ({ default: () => <i>lang</i> }))
vi.mock('@/components/chat/MessageList', () => ({ default: ({ messages, empty, footer }: any) => <div>{messages.length ? messages.map((m: any) => <p key={m.id}>{m.text}</p>) : empty}{footer}</div> }))
vi.mock('@/components/chat/PresenceBadge', () => ({ default: () => <i>presence</i> }))
vi.mock('@/components/chat/TypingIndicator', () => ({ default: ({ label }: any) => <p>{label}</p> }))
const chat: any = {}
vi.mock('@/components/chat/useSupportChat', () => ({ useSupportChat: () => chat }))

import SupportConversation from '@/components/admin/support/SupportConversation'

const baseSession = {
  id: 's1', channel: 'web', status: 'open', handler: 'ai', assignedAdminId: null, adminName: null,
  customer: { id: 'c1', name: 'Priya', phone: '+9198' }, ticket: 'T-100', customerLang: 'en',
}

describe('SupportConversation', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    scopes = { write: true, drive: false }
    Object.assign(chat, { session: baseSession, messages: [{ id: 'm1', sender: 'customer', text: 'Where is my order?' }], me: 'admin1', lang: 'en', typing: null, loading: false, error: null, setSession: vi.fn(), send: vi.fn(), retry: vi.fn(), upload: vi.fn(), notifyTyping: vi.fn(), setLanguage: vi.fn() })
    fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a loading pane until the session arrives, and an error when it fails', () => {
    chat.session = null
    const { rerender } = render(<SupportConversation sessionId="s1" />)
    expect(screen.getByRole('status', { name: 'Loading conversation' })).toBeInTheDocument()
    chat.error = 'Chat not found'
    rerender(<SupportConversation sessionId="s1" />)
    expect(screen.getByText('Chat not found')).toBeInTheDocument()
  })

  it('shows the customer, ticket, handler and messages', () => {
    const onSession = vi.fn()
    render(<SupportConversation sessionId="s1" onSession={onSession} />)
    expect(screen.getByRole('link', { name: 'Priya' }).getAttribute('href')).toContain('/admin/customers/c1/view')
    expect(screen.getByText('T-100')).toBeInTheDocument()
    expect(screen.getByText('Assistant is handling')).toBeInTheDocument()
    expect(screen.getByText('Where is my order?')).toBeInTheDocument()
    expect(onSession).toHaveBeenCalledWith(baseSession)
    expect(screen.getByPlaceholderText('Reply to take over from the assistant…')).toBeInTheDocument()
  })

  it('joins the chat and updates the session from the response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ session: { ...baseSession, handler: 'human' } }) })
    render(<SupportConversation sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Join chat/ }))
    await waitFor(() => expect(chat.setSession).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/support/sessions/s1/join')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('closes the chat with a PATCH and toasts a failure', async () => {
    render(<SupportConversation sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    await waitFor(() => expect(chat.setSession).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'closed' })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Not allowed' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not allowed', 'error'))
  })

  it('offers take over and hand back when a human holds the chat', () => {
    chat.session = { ...baseSession, handler: 'human', assignedAdminId: 'other', adminName: 'Ravi', handoffReason: 'Refund', handoffSummary: 'Wants a refund' }
    render(<SupportConversation sessionId="s1" />)
    expect(screen.getByText('Ravi is handling')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Take over/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hand back to the assistant' })).toBeInTheDocument()
    expect(screen.getByText(/Handed over by the assistant: Refund/)).toBeInTheDocument()
    expect(screen.getByText('Wants a refund')).toBeInTheDocument()
  })

  it('is read-only without write access, and a closed chat has no actions', () => {
    scopes.write = false
    const { rerender } = render(<SupportConversation sessionId="s1" />)
    expect(screen.queryByRole('button', { name: /Join chat/ })).not.toBeInTheDocument()
    expect(screen.getByText('You can read this chat but not reply.')).toBeInTheDocument()
    scopes.write = true
    chat.session = { ...baseSession, status: 'closed' }
    rerender(<SupportConversation sessionId="s1" />)
    expect(screen.getByText('This chat is closed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close chat' })).not.toBeInTheDocument()
  })

  it('shows the typing label, the WhatsApp window notice and fills quick replies with the store name', () => {
    chat.typing = { who: 'customer' }
    chat.session = { ...baseSession, channel: 'whatsapp', waWindowExpiresAt: '2020-01-01T00:00:00Z' }
    render(<SupportConversation sessionId="s1" onClose={vi.fn()} />)
    expect(screen.getByText('Priya is typing')).toBeInTheDocument()
    expect(screen.getByText(/WhatsApp only allows a template message/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quick replies' }))
    fireEvent.click(screen.getByText(/Hello! Thank you for reaching out to \{store\} support/))
    expect((screen.getByLabelText('composer') as HTMLInputElement).value).toContain('reaching out to Halo support')
  })
})
