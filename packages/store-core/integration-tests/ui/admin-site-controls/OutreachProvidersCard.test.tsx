import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// OutreachProvidersCard (flagship Settings → Providers, owner only): loads GET /api/admin/settings/providers/credentials,
// non-secret fields PUT /api/admin/settings/providers, secrets PUT .../credentials (write-only), Exotel test POST .../test.

vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => null, useToast: () => ({ showToast: vi.fn() }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import OutreachProvidersCard from '@/components/admin/site-controls/OutreachProvidersCard'

const set = (last4: string | null) => ({ configured: true, last4 })
const unset = { configured: false, last4: null }
const data = () => ({
  voice: {
    provider: 'exotel',
    exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+911401234567', appId: '12345', apiKey: set('1234'), apiToken: set('5678'), configured: true },
    twilioTest: { from: '', accountSid: set(null), authToken: set(null), source: 'messaging', configured: false },
    testNumbers: ['+919876543210'],
    sarvam: {
      sttModel: 'saaras:v3',
      ttsModel: 'bulbul:v3',
      voices: { en: 'ishita', hi: 'priya', ta: 'ishita', te: 'neha', kn: 'neha', ml: 'pooja', mr: 'priya', bn: 'roopa', gu: 'priya' },
      apiKey: unset,
      configured: false,
    },
    llmModel: 'claude-haiku-5-5',
    anthropic: { apiKey: set(null), source: 'env', federation: false, configured: true },
    ready: false,
  },
  dlt: { entityId: null, senderIds: [], source: { entityId: 'none', senderIds: 'none' } },
})

type Call = { url: string; method: string; body: any }
let calls: Call[]
function mockFetch(over: Partial<Record<string, any>> = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const key = `${method} ${url.split('?')[0]}`
      const body = key in over ? over[key] : key.endsWith('/credentials') && method === 'GET' ? data() : { ok: true }
      return { ok: !body?.error, json: async () => body }
    })
  )
}

const load = async () => {
  render(<OutreachProvidersCard owner />)
  await waitFor(() => expect(screen.getByText('Calling')).toBeInTheDocument())
}

describe('OutreachProvidersCard', () => {
  beforeEach(() => {
    canWrite = true
    mockFetch()
  })

  it('renders nothing and loads nothing for a non-owner', () => {
    const { container } = render(<OutreachProvidersCard owner={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the three sections with secrets masked, never as values', async () => {
    await load()
    expect(screen.getByText('Voice AI')).toBeInTheDocument()
    expect(screen.getByText('SMS India DLT')).toBeInTheDocument()
    const exotel = within(screen.getByTestId('secret-exotel'))
    expect(exotel.getByText('Configured · ••••1234')).toBeInTheDocument()
    expect(exotel.getByText('Configured · ••••5678')).toBeInTheDocument()
    expect(exotel.queryByLabelText('API key')).toBeNull()
    expect(screen.getByText('Using the ANTHROPIC_API_KEY environment key.')).toBeInTheDocument()
    expect(screen.getByText('Using the Twilio account that sends SMS and WhatsApp.')).toBeInTheDocument()
    expect(screen.getByText(/1002641844184516305/)).toBeInTheDocument()
    expect(screen.getByText(/DLT template ID is set on that template/)).toBeInTheDocument()
  })

  it('replaces a secret write-only: empty inputs, sent once on save, cleared after', async () => {
    await load()
    const box = within(screen.getByTestId('secret-exotel'))
    fireEvent.click(box.getByRole('button', { name: 'Replace' }))
    const token = box.getByLabelText('API token') as HTMLInputElement
    expect(token.type).toBe('password')
    expect(token.value).toBe('')
    fireEvent.change(token, { target: { value: 'new-exotel-token-9999' } })
    fireEvent.click(box.getByRole('button', { name: 'Save Exotel API credentials' }))
    await waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.url.endsWith('/credentials'))).toBe(true))
    const put = calls.find(c => c.method === 'PUT' && c.url.endsWith('/credentials'))!
    expect(put.body).toEqual({ provider: 'exotel', values: { apiToken: 'new-exotel-token-9999' } })
    await waitFor(() => expect(box.queryByLabelText('API token')).toBeNull())
    expect(screen.queryByDisplayValue('new-exotel-token-9999')).toBeNull()
  })

  it('shows a save error from the credentials API inline', async () => {
    mockFetch({ 'PUT /api/admin/settings/providers/credentials': { error: 'Also enter: apiToken' } })
    await load()
    const box = within(screen.getByTestId('secret-sarvam'))
    fireEvent.change(box.getByLabelText('API key'), { target: { value: 'sarvam-key-1' } })
    fireEvent.click(box.getByRole('button', { name: 'Save Sarvam API key' }))
    await waitFor(() => expect(box.getByText('Also enter: apiToken')).toBeInTheDocument())
  })

  it('removes a stored secret', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Exotel API credentials' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url.includes('provider=exotel'))).toBe(true))
  })

  it('validates test numbers as E.164 and saves the list through voice_config', async () => {
    await load()
    const input = screen.getByLabelText('Add to Test numbers')
    fireEvent.change(input, { target: { value: '98765' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByText('Use E.164: + then country code and number.')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '+91 91234 56789' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByText('+919123456789')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save test numbers' }))
    await waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.url === '/api/admin/settings/providers')).toBe(true))
    const put = calls.find(c => c.method === 'PUT' && c.url === '/api/admin/settings/providers')!
    expect(put.body.key).toBe('voice_config')
    expect(put.body.tenantId).toBeNull()
    expect(put.body.value.testNumbers).toEqual(['+919876543210', '+919123456789'])
    expect(JSON.stringify(put.body)).not.toMatch(/configured|last4/)
  })

  it('flags an invalid caller number and blocks the save', async () => {
    await load()
    fireEvent.change(screen.getByLabelText('Caller number'), { target: { value: 'call me' } })
    expect(screen.getByText('A phone number, e.g. +911401234567.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Exotel settings' })).toBeDisabled()
  })

  it('validates and saves DLT sender IDs upper-cased', async () => {
    await load()
    const input = screen.getByLabelText('Add to Sender IDs')
    fireEvent.change(input, { target: { value: 'JEF' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    expect(screen.getByText('6 letters or digits, e.g. JEFFIS.')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'jeffis' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save sender IDs' }))
    await waitFor(() => expect(calls.some(c => c.body?.key === 'sms_dlt_sender_ids')).toBe(true))
    expect(calls.find(c => c.body?.key === 'sms_dlt_sender_ids')!.body.value).toEqual(['JEFFIS'])
  })

  it('shows the Exotel test result inline', async () => {
    mockFetch({ 'POST /api/admin/settings/providers/credentials/test': { ok: false, message: 'Exotel rejected the API key or token.' } })
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Test Exotel' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Exotel rejected the API key or token.'))
    expect(calls.find(c => c.url.endsWith('/test'))!.body).toEqual({ provider: 'exotel' })
  })

  it('is read-only without settings:write', async () => {
    canWrite = false
    await load()
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Test Exotel' })).toBeNull()
    expect(screen.queryByLabelText('Add to Test numbers')).toBeNull()
    expect(screen.getByText('+919876543210')).toBeInTheDocument()
  })
})
