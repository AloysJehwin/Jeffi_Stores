import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import QrPaymentDialog, { createQrIntent, type QrIntent } from '@/components/admin/payments/QrPaymentDialog'

// QR-first payment dialog: polls the intent, then waits -> paid -> done / failed / expired. Fake timers and a mocked fetch.

const NOW = new Date('2026-11-27T10:00:00Z')
const intent: QrIntent = { intentId: 'pi_1', qrImageUrl: 'https://cdn.test/qr.png', amount: 1180, expiresAt: new Date(NOW.getTime() + 125_000).toISOString() }

const fetchMock = vi.fn()
let status: Record<string, unknown>
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function draw(over: Partial<React.ComponentProps<typeof QrPaymentDialog>> = {}) {
  const props = { intent, onClose: vi.fn(), onDone: vi.fn(), onNewQr: vi.fn(), ...over }
  render(<QrPaymentDialog {...props} />)
  return props
}

describe('QrPaymentDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    status = { status: 'pending' }
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith('/cancel') && init?.method === 'POST') return json(true, {})
      return json(true, status)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders nothing without an intent', () => {
    draw({ intent: null })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the amount, QR, waiting state and countdown', async () => {
    draw()
    expect(screen.getByText('₹1,180.00')).toBeInTheDocument()
    expect(screen.getByAltText('UPI QR code')).toHaveAttribute('src', 'https://cdn.test/qr.png')
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    expect(screen.getByText('Expires in 2:05')).toBeInTheDocument()
    await tick(5000)
    expect(screen.getByText('Expires in 2:00')).toBeInTheDocument()
  })

  it('polls the intent every 2.5 seconds while pending', async () => {
    draw()
    expect(fetchMock).not.toHaveBeenCalled()
    await tick(2500)
    await tick(2500)
    const polls = fetchMock.mock.calls.filter(c => c[0] === '/api/admin/payments/qr-intents/pi_1')
    expect(polls).toHaveLength(2)
    expect(polls[0][1]).toEqual({ credentials: 'include' })
  })

  it('moves to the creating state once paid, then reports the result once when finalised', async () => {
    const p = draw()
    status = { status: 'paid' }
    await tick(2500)
    expect(screen.getByText('Paid — creating the invoice…')).toBeInTheDocument()
    expect(screen.queryByAltText('UPI QR code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(p.onDone).not.toHaveBeenCalled()
    status = { status: 'finalised', resultRef: 'o1', resultUrl: '/admin/invoices/o1/view' }
    await tick(2500)
    await tick(5000)
    expect(p.onDone).toHaveBeenCalledTimes(1)
    expect(p.onDone).toHaveBeenCalledWith({ resultRef: 'o1', resultUrl: '/admin/invoices/o1/view' })
  })

  it('shows the failure reason and a Close button, and stops polling', async () => {
    const p = draw()
    status = { status: 'failed', error: 'Stock changed' }
    await tick(2500)
    expect(screen.getByRole('alert')).toHaveTextContent("Paid. Couldn't create the invoice: Stock changed")
    const calls = fetchMock.mock.calls.length
    await tick(7500)
    expect(fetchMock.mock.calls.length).toBe(calls)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(p.onClose).toHaveBeenCalled()
    expect(p.onDone).not.toHaveBeenCalled()
  })

  it('offers a new QR when the intent expired', async () => {
    const p = draw()
    status = { status: 'expired' }
    await tick(2500)
    expect(screen.getByText('This QR has expired.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New QR' }))
    expect(p.onNewQr).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('Cancel posts to the cancel route and closes', async () => {
    const p = draw()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/payments/qr-intents/pi_1/cancel', { method: 'POST', credentials: 'include' })
    expect(p.onClose).toHaveBeenCalled()
  })

  it('shows Expiring… once the countdown hits zero and keeps polling', async () => {
    draw()
    await tick(126_000)
    expect(screen.getByText('Expiring…')).toBeInTheDocument()
  })

  it('ignores transient poll errors', async () => {
    const p = draw()
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })
    await tick(2500)
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    expect(p.onDone).not.toHaveBeenCalled()
  })
})

describe('createQrIntent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts kind and payload and returns the intent', async () => {
    fetchMock.mockResolvedValue(json(true, intent))
    await expect(createQrIntent('cash_sale', { paymentMode: 'upi_qr' })).resolves.toEqual(intent)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/payments/qr-intents')
    expect(JSON.parse(init.body)).toEqual({ kind: 'cash_sale', payload: { paymentMode: 'upi_qr' } })
  })

  it('throws the server error message', async () => {
    fetchMock.mockResolvedValue(json(false, { error: 'Insufficient stock for Drill' }))
    await expect(createQrIntent('invoice', {})).rejects.toThrow('Insufficient stock for Drill')
  })
})
