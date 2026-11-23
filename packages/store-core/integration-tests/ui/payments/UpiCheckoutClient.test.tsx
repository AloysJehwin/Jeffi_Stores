import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import UpiCheckoutClient, { UpiCheckoutLoading, upiAppLinks } from '@/components/payments/UpiCheckoutClient'
import type { UpiIntentView } from '@/components/payments/useUpiPayment'

// Our own UPI checkout page: polls GET apiBase/<id> and renders a per-status panel (queued / active /
// processing / awaiting / cancelled / rejected / failed). We drive the branch by the mocked status.
// post() hits apiBase/<id>/{check,cancel,confirm}; we assert the button wires fire fetch with the right URL.

function mockPoll(view: UpiIntentView & { error?: string }, ok = true, status = 200) {
  const fn = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ ok, status, json: () => Promise.resolve(view) } as Response))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

describe('upiAppLinks', () => {
  it('builds deep links from the upiUri query, gpay flavoured per platform', () => {
    const links = upiAppLinks('upi://pay?pa=store@upi&am=10', false)
    expect(links.map(l => l.key)).toEqual(['gpay', 'phonepe', 'paytm', 'other'])
    expect(links[0].href).toContain('tez://upi/pay?') // android
    expect(upiAppLinks('upi://pay?pa=store@upi&am=10', true)[0].href).toContain('gpay://upi/pay?') // ios
  })

  it('returns no links when the uri has no query', () => {
    expect(upiAppLinks('upi://pay', false)).toEqual([])
  })
})

describe('UpiCheckoutClient (status branches)', () => {
  it('renders the loading frame before the first status arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never settles -> view stays null
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })

  it('renders the queued panel with position and a Cancel button', async () => {
    mockPoll({ status: 'queued', purpose: 'order', queuePosition: 3, amountPaise: 50000 })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText("You're #3 in line")).toBeInTheDocument()
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders the active pay panel with a countdown timer and the check button', async () => {
    mockPoll({
      status: 'active',
      purpose: 'order',
      amountPaise: 50000,
      payee: { vpa: 'store@upi', name: 'Jeffi' },
      payExpiresAt: new Date(Date.now() + 120000).toISOString(),
      serverNow: new Date().toISOString(),
      qrDataUrl: 'data:image/png;base64,QR',
      upiUri: 'upi://pay?pa=store@upi&am=500',
    })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Pay with UPI')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toBeInTheDocument()
    expect(screen.getByText('store@upi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check my payment/ })).toBeInTheDocument()
  })

  it('fires a check POST to apiBase/<id>/check when the check button is clicked', async () => {
    const fetchFn = mockPoll({
      status: 'active',
      purpose: 'order',
      amountPaise: 50000,
      payee: { vpa: 'store@upi', name: 'Jeffi' },
      payExpiresAt: new Date(Date.now() + 120000).toISOString(),
      qrDataUrl: 'data:image/png;base64,QR',
    })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" apiBase="/api/pay/upi" />)
    fireEvent.click(await screen.findByRole('button', { name: /check my payment/ }))
    const calls = fetchFn.mock.calls.map(c => String(c[0]))
    expect(calls.some(u => u === '/api/pay/upi/int_1/check')).toBe(true)
  })

  it('renders the processing panel with a seconds timer', async () => {
    mockPoll({
      status: 'processing',
      purpose: 'order',
      amountPaise: 50000,
      verifyExpiresAt: new Date(Date.now() + 25000).toISOString(),
      serverNow: new Date().toISOString(),
    })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Checking with your bank…')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toBeInTheDocument()
  })

  it('renders the awaiting panel with a Continue link', async () => {
    mockPoll({ status: 'awaiting_confirmation', purpose: 'order', result: { orderId: 'o1', orderNumber: '1009' }, returnTo: '/orders/o1' })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment noted')).toBeInTheDocument()
    expect(screen.getByText(/for order #1009/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View order' })).toHaveAttribute('href', '/orders/o1')
  })

  it('renders the cancelled panel with a try-again link', async () => {
    mockPoll({ status: 'cancelled', purpose: 'order', returnTo: '/checkout' })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment cancelled')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/checkout')
  })

  it('renders the failed panel with a UTR fallback form for non-phonepe providers', async () => {
    mockPoll({ status: 'failed', purpose: 'order', provider: 'upg' })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText(/We couldn't see your payment yet/)).toBeInTheDocument()
    expect(screen.getByLabelText(/UTR \/ transaction reference/)).toBeInTheDocument()
  })

  it('omits the UTR form for phonepe-provider failures', async () => {
    mockPoll({ status: 'failed', purpose: 'order', provider: 'phonepe' })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment not completed')).toBeInTheDocument()
    expect(screen.queryByLabelText(/UTR \/ transaction reference/)).not.toBeInTheDocument()
  })

  it('submits a confirm POST with the upper-cased UTR from the failed form', async () => {
    const fetchFn = mockPoll({ status: 'failed', purpose: 'order', provider: 'upg' })
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" apiBase="/api/pay/upi" />)
    const input = (await screen.findByLabelText(/UTR \/ transaction reference/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abcd1234efgh' } })
    fireEvent.submit(input.closest('form')!)
    const confirmCall = fetchFn.mock.calls.find(c => String(c[0]) === '/api/pay/upi/int_1/confirm')
    expect(confirmCall).toBeTruthy()
    expect(JSON.parse((confirmCall![1] as RequestInit).body as string)).toEqual({ utr: 'ABCD1234EFGH' })
  })

  it('shows the not-found panel on a 404 poll', async () => {
    mockPoll({ status: 'pending', purpose: 'order', error: 'This payment could not be found.' } as UpiIntentView & { error: string }, false, 404)
    render(<UpiCheckoutClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/account')
  })
})

describe('UpiCheckoutLoading', () => {
  it('renders the skeleton frame with a busy status region', () => {
    render(<UpiCheckoutLoading />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(within(status).queryByText(/./)).toBeNull() // skeleton only, no copy
  })
})
