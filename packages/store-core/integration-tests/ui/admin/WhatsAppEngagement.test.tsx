import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

let canWrite = true
let canDrive = false
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite, useHasScope: () => canDrive }))
vi.mock('@/components/admin/drive/api', () => ({ driveToAttachment: (x: any) => x }))
vi.mock('@/components/admin/drive/DrivePicker', () => ({ useDrivePicker: () => ({ pick: async () => null, node: null }) }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: () => null }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, placeholder }: any) => (
    <select aria-label="template" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/chat/ChatShell', () => ({
  default: ({ banner, composer, children }: any) => <div>{banner}{children}{composer}</div>,
}))
vi.mock('@/components/chat/MessageList', () => ({
  default: ({ messages, empty }: any) => (
    <div>
      {messages.length === 0 ? empty : messages.map((m: any) => <p key={m.id} data-sender={m.sender} data-status={m.status}>{m.text}</p>)}
    </div>
  ),
}))
vi.mock('@/components/chat/Composer', () => ({
  default: ({ text, setText, onSend, accessory, disabled }: any) => (
    <div>
      <input aria-label="message" value={text} onChange={e => setText(e.target.value)} disabled={disabled} />
      <button onClick={() => onSend(text, [])}>Send message</button>
      {accessory}
    </div>
  ),
}))

import WhatsAppEngagement from '@/components/admin/WhatsAppEngagement'

const thread = [
  { id: 'm1', direction: 'inbound', body: 'Is it in stock?', kind: null, status: 'received', delivery_status: null, sent_at: '2026-11-20T10:00:00Z', error: null, to_number: null, from_number: '+91', provider_sid: null },
  { id: 'm2', direction: 'outbound', body: 'Yes it is', kind: 'reorder_reminder', status: 'sent', delivery_status: 'READ', sent_at: '2026-11-20T10:05:00Z', error: null, to_number: '+91', from_number: null, provider_sid: null },
]
const payload = {
  thread,
  templates: {
    abandoned_cart: { label: 'Abandoned cart', category: 'marketing', fields: ['items'] },
    feedback_request: { label: 'Feedback request', category: 'support', fields: ['orderNumber', 'url'] },
  },
  prefill: { cartItemsSummary: '2x Drill', cartCount: 2, latestOrder: { order_number: 'ORD-5', total_amount: 100, id: 'o5' }, latestOrderProduct: 'Drill', notifyProduct: '', feedbackUrl: 'https://s.test/fb', cartUrl: '', amountFormatted: '₹100' },
  availability: { abandoned_cart: true, feedback_request: false },
}
const fetchMock = vi.fn<(...a: any[]) => any>()
const ok = (data: any) => ({ ok: true, json: async () => data })

beforeEach(() => {
  canWrite = true
  canDrive = false
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? ok({ success: true }) : ok(payload)))
})
afterEach(() => vi.useRealTimers())

describe('WhatsAppEngagement', () => {
  it('says so when the customer has no phone number', () => {
    render(<WhatsAppEngagement customerId="c1" phone={null} />)
    expect(screen.getByText('No phone number on file for this customer.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a collapsed accordion that loads the thread only when opened', async () => {
    render(<WhatsAppEngagement customerId="c1" phone="+919999999999" marketingOptOut />)
    expect(screen.getByText('Opted out')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('WhatsApp Engagement'))
    expect(await screen.findByText('Is it in stock?')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/customers/c1/whatsapp')
    expect(screen.getByText('Yes it is')).toHaveAttribute('data-sender', 'admin')
    expect(screen.getByText('Yes it is')).toHaveAttribute('data-status', 'read')
    expect(screen.getByText('Is it in stock?')).toHaveAttribute('data-sender', 'customer')
  })

  it('renders straight into the conversation in modal mode and shows the empty state', async () => {
    fetchMock.mockResolvedValue(ok({ thread: [] }))
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    expect(await screen.findByText('No WhatsApp messages yet.')).toBeInTheDocument()
  })

  it('sends a free-text reply, clears the box and reloads the thread', async () => {
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    await screen.findByText('Is it in stock?')
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'Shipping today' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ text: 'Shipping today', attachmentIds: [] })
    await waitFor(() => expect(screen.getByLabelText('message')).toHaveValue(''))
  })

  it('shows the send error and restores the text on failure', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? ok({ success: false, error: 'Outside the 24h window' }) : ok(payload)))
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    await screen.findByText('Is it in stock?')
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Outside the 24h window')).toBeInTheDocument()
    expect(screen.getByLabelText('message')).toHaveValue('Hello')
  })

  it('has no composer without customers write access', async () => {
    canWrite = false
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    await screen.findByText('Is it in stock?')
    expect(screen.queryByLabelText('message')).not.toBeInTheDocument()
  })

  it('sends a template with prefilled variables', async () => {
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    await screen.findByText('Is it in stock?')
    fireEvent.click(screen.getByLabelText('Send a template'))
    fireEvent.change(screen.getByLabelText('template'), { target: { value: 'abandoned_cart' } })
    expect(screen.getByPlaceholderText('items')).toHaveValue('2x Drill')
    fireEvent.click(screen.getByRole('button', { name: 'Send template' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ templateKey: 'abandoned_cart', variables: { items: '2x Drill' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send template' })).not.toBeInTheDocument())
  })

  it('warns about marketing opt-out and blocks templates that are unavailable', async () => {
    render(<WhatsAppEngagement customerId="c1" phone="+91" marketingOptOut forceOpen />)
    await screen.findByText('Is it in stock?')
    fireEvent.click(screen.getByLabelText('Send a template'))
    expect(screen.getByRole('option', { name: 'Feedback request — no orders yet' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('template'), { target: { value: 'abandoned_cart' } })
    expect(screen.getByText(/opted out of marketing/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('template'), { target: { value: 'feedback_request' } })
    expect(screen.queryByText(/opted out of marketing/)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('orderNumber')).toHaveValue('ORD-5')
    expect(screen.getByRole('button', { name: /Unavailable — no orders yet/ })).toBeDisabled()
  })

  it('polls the thread every 10 seconds while open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<WhatsAppEngagement customerId="c1" phone="+91" forceOpen />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
