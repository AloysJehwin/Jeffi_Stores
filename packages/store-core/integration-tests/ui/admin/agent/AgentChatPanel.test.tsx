import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/admin/AdminAgentMessage', () => ({
  default: ({ text }: any) => <div data-testid="assistant-text">{text}</div>,
  AdminAgentUserMessage: ({ text }: any) => <span>{text}</span>,
  internalMessageLabel: (t: string | null | undefined) => (t === '__confirm__' ? 'Confirmed 2 items for the quotation' : null),
}))
vi.mock('@/components/admin/AdminAgentBlocks', () => ({
  default: ({ blocks, onPickOption, onSendMessage }: any) => (
    <div data-testid="blocks">
      {blocks.length} blocks
      <button onClick={() => onPickOption('customer', { id: 'c1', label: 'Priya' })}>block pick</button>
      <button onClick={() => onSendMessage('from block')}>block send</button>
    </div>
  ),
}))
const confirmFn = vi.fn()
const promptFn = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirmFn, usePrompt: () => promptFn }))
let hasDrive = false
vi.mock('@/contexts/AdminScopesContext', () => ({ useHasScope: () => hasDrive }))
const pickFile = vi.fn()
vi.mock('@/components/admin/drive/DrivePicker', () => ({ useDrivePicker: () => ({ pick: pickFile, node: <div data-testid="drive-node" /> }) }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/AdminHostContext', () => ({ useAdminHost: () => 'localhost' }))

import AgentChatPanel, { chatTitle } from '@/components/admin/agent/AgentChatPanel'

function mkChat(o: any = {}): any {
  return {
    turns: [], loading: false, info: { title: null, shared: false, readOnly: false, ownerName: null }, conversationId: null,
    conversations: [], loadingHistory: false, pendingFile: null, uploading: false, attachmentId: null, input: '',
    fileInputRef: { current: null },
    setInput: vi.fn(), setTurns: vi.fn(), sendMessage: vi.fn(), stop: vi.fn(), reset: vi.fn(), retry: vi.fn(),
    pick: vi.fn(), decideAction: vi.fn(), decideAll: vi.fn().mockResolvedValue(undefined),
    loadConversation: vi.fn().mockResolvedValue(true), loadConversations: vi.fn(), patchConversation: vi.fn().mockResolvedValue(true),
    deleteConversation: vi.fn(), attachFromDrive: vi.fn(), clearAttachment: vi.fn(), onPickFile: vi.fn(), ...o,
  }
}
const panel = (chat: any, p: any = {}) => render(<AgentChatPanel chat={chat} variant="dock" showHistory={false} empty={<p>Nothing yet</p>} {...p} />)

beforeEach(() => {
  hasDrive = false
  confirmFn.mockReset()
  promptFn.mockReset()
  pickFile.mockReset()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true })
})

describe('chatTitle', () => {
  it('strips attachment markers, labels control messages and falls back', () => {
    expect(chatTitle('Check this [attachment_id=a1 filename="inv.pdf"]')).toBe('Check this')
    expect(chatTitle('__confirm__')).toBe('Confirmed 2 items for the quotation')
    expect(chatTitle(null)).toBe('Untitled chat')
    expect(chatTitle('Cut off [attachment_id=abc')).toBe('Cut off')
  })
})

describe('transcript', () => {
  it('shows the empty slot with no turns', () => {
    panel(mkChat())
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
  })

  it('renders user and assistant turns with copy and model meta', async () => {
    const chat = mkChat({
      turns: [
        { id: 'u1', role: 'user', content: 'Show orders' },
        { id: 'a1', role: 'assistant', content: '3 orders found', provider: 'anthropic', model: 'sonnet', usage: { promptTokens: 1500, completionTokens: 200, costInr: 0.5 } },
      ],
    })
    panel(chat)
    expect(screen.getByText('Show orders')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-text')).toHaveTextContent('3 orders found')
    expect(screen.getByText(/Claude · sonnet · 1\.5k in · 200 out · ₹0\.500/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('3 orders found'))
  })

  it('shows Thinking while a turn streams with nothing yet and hides a half-written ui_blocks payload', () => {
    const { rerender } = panel(mkChat({ turns: [{ id: 'a1', role: 'assistant', content: '', streaming: true }] }))
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    rerender(<AgentChatPanel chat={mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'Working <ui_blocks>[{"a', streaming: true }] })} variant="dock" showHistory={false} empty={null} />)
    expect(screen.getByTestId('assistant-text')).toHaveTextContent(/^Working\s*$/)
  })

  it('lists tool calls in a timeline that expands to show a step’s input and output', () => {
    const timeline = [
      { kind: 'note', text: 'Looking up orders' },
      { kind: 'tool', step: { id: 's1', name: 'list_orders', input: { status: 'paid' }, output: { count: 3 }, status: 'ok', durationMs: 1200 } },
      { kind: 'tool', step: { id: 's2', name: 'bad_tool', input: {}, output: 'boom', status: 'error' } },
    ]
    panel(mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'done', timeline }] }))
    const header = screen.getByRole('button', { name: /2 tool calls/ })
    expect(header).toHaveTextContent('1.2s')
    expect(header).toHaveTextContent('1 failed')
    expect(screen.queryByText('list_orders')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('Looking up orders')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /list_orders/ }))
    expect(screen.getByText(/"count": 3/)).toBeInTheDocument()
  })

  it('shows a turn error with Retry', () => {
    const chat = mkChat({ turns: [{ id: 'a1', role: 'assistant', content: '', error: 'Gateway down', retryText: 'Show orders' }] })
    panel(chat)
    expect(screen.getByText('Gateway down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(chat.retry).toHaveBeenCalledWith('a1')
  })

  it('offers pickers and reports the choice', () => {
    const chat = mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'Which one?', pickers: [{ choice_kind: 'customer', note: 'several match', options: [{ id: 'c1', label: 'Priya', sublabel: 'Pune' }] }] }] })
    panel(chat)
    expect(screen.getByText(/Pick a customer — several match/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Priya/ }))
    expect(chat.pick).toHaveBeenCalledWith('a1', 'customer', expect.objectContaining({ id: 'c1' }))
  })

  it('renders blocks and routes their picks and messages through the chat', () => {
    const chat = mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'See below', uiBlocks: [{ type: 'text' }] }] })
    panel(chat)
    expect(screen.getByTestId('blocks')).toHaveTextContent('1 blocks')
    fireEvent.click(screen.getByRole('button', { name: 'block pick' }))
    expect(chat.pick).toHaveBeenCalledWith('a1', 'customer', { id: 'c1', label: 'Priya' })
    fireEvent.click(screen.getByRole('button', { name: 'block send' }))
    expect(chat.sendMessage).toHaveBeenCalledWith('from block')
    expect(chat.setTurns).toHaveBeenCalled()
  })
})

describe('proposed actions', () => {
  const actions = [
    { id: 'p1', kind: 'create_quotation', payload: {}, confirmation: 'Create QT?', status: 'proposed' },
    { id: 'p2', kind: 'send_email', payload: {}, confirmation: 'Email Acme?', status: 'proposed' },
  ]

  it('shows a card per action, decides one, and approves all at once', async () => {
    const chat = mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'Proposals', proposedActions: actions }] })
    panel(chat)
    expect(screen.getByText('Create QT?')).toBeInTheDocument()
    expect(screen.getByText('2 changes waiting')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^Approve$/ })[0])
    expect(chat.decideAction).toHaveBeenCalledWith('a1', 'p1', 'approve')
    fireEvent.click(screen.getByRole('button', { name: 'Approve all (2)' }))
    await waitFor(() => expect(chat.decideAll).toHaveBeenCalledWith('a1', 'approve'))
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }))
    await waitFor(() => expect(chat.decideAll).toHaveBeenCalledWith('a1', 'reject'))
  })

  it('hides the batch bar for a single pending action', () => {
    panel(mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'x', proposedActions: [actions[0]] }] }))
    expect(screen.queryByText(/changes waiting/)).toBeNull()
  })

  it('gates the buttons through the wrapper', () => {
    panel(mkChat({ turns: [{ id: 'a1', role: 'assistant', content: 'x', proposedActions: actions }] }), { approveWrapper: (n: any) => <div data-testid="gate">{n}</div> })
    expect(screen.getAllByTestId('gate').length).toBeGreaterThan(0)
  })
})

describe('composer', () => {
  it('sends on Enter but not Shift+Enter, and Send needs 2+ characters', () => {
    const chat = mkChat({ input: 'hello there' })
    panel(chat)
    const box = screen.getByPlaceholderText('Ask anything about the store')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(chat.sendMessage).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(chat.sendMessage).toHaveBeenCalledWith('hello there')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(chat.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('typing updates the input; a one-letter input disables Send', () => {
    const chat = mkChat({ input: 'a' })
    panel(chat)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Ask anything about the store'), { target: { value: 'ab' } })
    expect(chat.setInput).toHaveBeenCalledWith('ab')
  })

  it('shows Stop while loading and disables the box', () => {
    const chat = mkChat({ loading: true })
    panel(chat)
    expect(screen.getByPlaceholderText('Ask anything about the store')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(chat.stop).toHaveBeenCalledTimes(1)
  })

  it('shows the pending attachment with its size and lets you remove it', () => {
    const chat = mkChat({ pendingFile: { name: 'invoice.pdf', size: 20480, type: 'application/pdf' }, attachmentId: 'att1' })
    panel(chat)
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getByText('20 KB')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Add an instruction (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
    expect(chat.clearAttachment).toHaveBeenCalledTimes(1)
  })

  it('attach from Drive only with drive scope, and hands the pick to the chat', async () => {
    const { unmount } = panel(mkChat())
    expect(screen.queryByRole('button', { name: 'Attach from Drive' })).toBeNull()
    unmount()
    hasDrive = true
    pickFile.mockResolvedValue([{ id: 'f1', name: 'a.png' }])
    const chat = mkChat()
    panel(chat)
    fireEvent.click(screen.getByRole('button', { name: 'Attach from Drive' }))
    await waitFor(() => expect(chat.attachFromDrive).toHaveBeenCalledWith({ id: 'f1', name: 'a.png' }))
    expect(screen.getByTestId('drive-node')).toBeInTheDocument()
  })
})

describe('read-only shared chat', () => {
  it('replaces the composer with a continue bar that starts a new chat prefilled', () => {
    const chat = mkChat({ info: { title: 'Q4 plan', shared: true, readOnly: true, ownerName: 'Priya' }, turns: [{ id: 'a1', role: 'assistant', content: 'x', proposedActions: [{ id: 'p1', kind: 'k', payload: {}, confirmation: 'c', status: 'proposed' }] }] })
    panel(chat, { approveWrapper: (n: any) => n })
    expect(screen.getByText('Shared by Priya · read-only')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Ask anything about the store')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue in a new chat' }))
    expect(chat.reset).toHaveBeenCalled()
    expect(chat.setInput).toHaveBeenCalledWith('Following up on "Q4 plan": ')
  })
})

describe('history list', () => {
  const convs = [
    { id: 'c1', title: 'Stock check', preview: null, shared: false, last_message_at: '2026-01-05T10:00:00Z', message_count: 4 },
    { id: 'c2', title: 'Shared chat', preview: null, shared: true, last_message_at: '2026-01-04T10:00:00Z', message_count: 2, channel: 'whatsapp' },
  ]

  it('shows an empty message, a refresh and the privacy note', () => {
    const chat = mkChat()
    panel(chat, { showHistory: true })
    expect(screen.getByText('No past conversations.')).toBeInTheDocument()
    expect(screen.getByText(/Only you can see your chats/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('refresh'))
    expect(chat.loadConversations).toHaveBeenCalledTimes(1)
  })

  it('opens a conversation and then reports the pick', async () => {
    const chat = mkChat({ conversations: convs })
    const onPicked = vi.fn()
    panel(chat, { showHistory: true, onConversationPicked: onPicked })
    fireEvent.click(screen.getByText('Stock check'))
    await waitFor(() => expect(chat.loadConversation).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(onPicked).toHaveBeenCalled())
    expect(screen.getByText(/4 msg/)).toBeInTheDocument()
    expect(screen.getByLabelText('WhatsApp')).toBeInTheDocument()
  })

  it('renames through a prompt and ignores a blank name', async () => {
    const chat = mkChat({ conversations: [convs[0]] })
    promptFn.mockResolvedValueOnce('  Renamed  ').mockResolvedValueOnce('   ')
    panel(chat, { showHistory: true })
    fireEvent.click(screen.getByTitle('Rename'))
    await waitFor(() => expect(chat.patchConversation).toHaveBeenCalledWith('c1', { title: 'Renamed' }))
    chat.patchConversation.mockClear()
    fireEvent.click(screen.getByTitle('Rename'))
    await Promise.resolve()
    await Promise.resolve()
    expect(chat.patchConversation).not.toHaveBeenCalled()
  })

  it('deletes only after confirming', async () => {
    const chat = mkChat({ conversations: [convs[1]] })
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    panel(chat, { showHistory: true })
    fireEvent.click(screen.getByTitle('Delete'))
    await Promise.resolve()
    await Promise.resolve()
    expect(chat.deleteConversation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('Delete'))
    await waitFor(() => expect(chat.deleteConversation).toHaveBeenCalledWith('c2'))
    expect(confirmFn.mock.calls[1][0].message).toContain('shared link stops working')
  })

  it('sharing copies the link and toasts; stopping sharing toasts privately', async () => {
    const chat = mkChat({ conversations: [convs[0], convs[1]] })
    panel(chat, { showHistory: true })
    fireEvent.click(screen.getAllByTitle('Share read-only with other admins')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Shared read-only with other admins · link copied', 'success'))
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toMatch(/\/admin\/agent\?c=c1$/)
    fireEvent.click(screen.getByTitle('Stop sharing'))
    await waitFor(() => expect(chat.patchConversation).toHaveBeenCalledWith('c2', { shared: false }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Chat is private again', 'success'))
  })
})
