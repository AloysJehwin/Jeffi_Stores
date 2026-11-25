import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
let overview: { data: any; error: any; reload: ReturnType<typeof vi.fn> } = { data: null, error: null, reload: vi.fn() }
const showToast = vi.fn<(...a: any[]) => any>()

vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/overview/kit', () => ({ useOverviewData: () => overview }))

import RazorpayAccountCard from '@/components/admin/RazorpayAccountCard'

const info = (o: Record<string, any> = {}) => ({
  kind: 'own', ownFlag: true, keyId: 'rzp_live_abc', mode: 'live', editable: true, webhookSecretSet: true,
  webhookUrl: 'https://shop.test/api/webhooks/razorpay', events: ['payment.captured', 'refund.processed'],
  lastWebhookAt: new Date().toISOString(), ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()
const reload = vi.fn<(...a: any[]) => any>()
const set = (data: any, error: any = null) => { overview = { data, error, reload } }

beforeEach(() => {
  canWrite = true
  set(info())
  vi.stubGlobal('fetch', fetchMock)
})

const open = () => fireEvent.click(screen.getByText('Razorpay account'))

describe('RazorpayAccountCard', () => {
  it('renders nothing on a load error and a placeholder while loading', () => {
    set(null, new Error('x'))
    const { container, rerender } = render(<RazorpayAccountCard />)
    expect(container.firstChild).toBeNull()
    set(null)
    rerender(<RazorpayAccountCard />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('summarises the account: own keys, live mode and webhook freshness', () => {
    render(<RazorpayAccountCard />)
    expect(screen.getByText(/Your own account · rzp_live_abc/)).toBeInTheDocument()
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('webhook 1 min ago')).toBeInTheDocument()
  })

  it('flags a platform account with no webhook yet, and missing own keys', () => {
    set(info({ kind: 'platform', ownFlag: false, lastWebhookAt: null, mode: 'test' }))
    const { rerender } = render(<RazorpayAccountCard />)
    expect(screen.getByText('no webhook yet')).toBeInTheDocument()
    expect(screen.getByText(/Platform account/)).toBeInTheDocument()
    set(info({ keyId: null, mode: null }))
    rerender(<RazorpayAccountCard />)
    expect(screen.getByText('keys not set')).toBeInTheDocument()
  })

  it('expands to show the webhook URL, events and copies the URL', async () => {
    const writeText = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<RazorpayAccountCard />)
    open()
    expect(screen.getByText('https://shop.test/api/webhooks/razorpay')).toBeInTheDocument()
    expect(screen.getByText('payment.captured')).toBeInTheDocument()
    expect(screen.getByText(/webhook secret/)).toHaveTextContent('(set)')
    fireEvent.click(screen.getByTitle('Copy'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied.', 'success'))
    expect(writeText).toHaveBeenCalledWith('https://shop.test/api/webhooks/razorpay')
  })

  it('tests the connection and toasts the result', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'Connected to Razorpay.' }) })
    render(<RazorpayAccountCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Connected to Razorpay.', 'success'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'test' })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, message: 'Bad keys' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Bad keys', 'error'))
  })

  it('hides Test connection without financial:write', () => {
    canWrite = false
    render(<RazorpayAccountCard />)
    open()
    expect(screen.queryByRole('button', { name: 'Test connection' })).not.toBeInTheDocument()
  })

  it('explains that platform keys are not editable', () => {
    set(info({ kind: 'platform', ownFlag: false, editable: false }))
    render(<RazorpayAccountCard />)
    open()
    expect(screen.getByText(/platform's keys come from the server settings/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change keys' })).not.toBeInTheDocument()
  })

  it('edits keys: Save needs id and secret, posts, resets and reloads', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Razorpay keys saved.' }) })
    const { container } = render(<RazorpayAccountCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change keys' }))
    const save = screen.getByRole('button', { name: 'Save keys' })
    expect(save).toBeDisabled()
    const [id, secret, hook] = Array.from(container.querySelectorAll('input'))
    fireEvent.change(id, { target: { value: 'rzp_live_new' } })
    fireEvent.change(secret, { target: { value: 'shh' } })
    fireEvent.change(hook, { target: { value: 'whsec' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'save', key_id: 'rzp_live_new', key_secret: 'shh', webhook_secret: 'whsec' })
    expect(showToast).toHaveBeenCalledWith('Razorpay keys saved.', 'success')
    expect(screen.queryByRole('button', { name: 'Save keys' })).not.toBeInTheDocument()
  })

  it('shows the save error and keeps the form open', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Razorpay rejected the keys' }) })
    const { container } = render(<RazorpayAccountCard />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Change keys' }))
    const [id, secret] = Array.from(container.querySelectorAll('input'))
    fireEvent.change(id, { target: { value: 'a' } })
    fireEvent.change(secret, { target: { value: 'b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save keys' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Razorpay rejected the keys', 'error'))
    expect(screen.getByRole('button', { name: 'Save keys' })).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('offers Add keys and a warning when own keys are missing', () => {
    set(info({ keyId: null, webhookSecretSet: false }))
    render(<RazorpayAccountCard />)
    open()
    expect(screen.getByRole('button', { name: 'Add keys' })).toBeInTheDocument()
    expect(screen.getByText(/no keys are saved/)).toBeInTheDocument()
    expect(screen.getByText(/not set — add one below/)).toBeInTheDocument()
  })
})
