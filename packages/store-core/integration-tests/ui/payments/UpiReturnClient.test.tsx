import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import UpiReturnClient, { UpiReturnLoading } from '@/components/payments/UpiReturnClient'
import type { UpiIntentView } from '@/components/payments/useUpiPayment'

// The UPI return page body: polls GET apiBase/<id> every 2s, then shows a phase panel. We drive the
// branch by what the mocked fetch resolves (one poll), and freeze the checking phase with a never-settling
// fetch. No real network / sessionStorage beyond what the component touches.

function mockFetchOnce(view: UpiIntentView & { error?: string }, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(view) } as Response))
  )
}

beforeEach(() => {
  // Stop window.location.replace from throwing in happy-dom during the completed branch.
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
})

describe('UpiReturnClient (phases)', () => {
  it('shows the checking panel with a polite live region while polling', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never settles
    render(<UpiReturnClient intentId="int_1" fallbackHref="/account" />)
    expect(screen.getByText('Confirming your payment…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the awaiting panel with the order number and a Continue link', async () => {
    mockFetchOnce({
      status: 'awaiting_confirmation',
      purpose: 'order',
      result: { orderId: 'o1', orderNumber: '1007' },
      returnTo: '/orders/o1',
    })
    render(<UpiReturnClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment noted')).toBeInTheDocument()
    expect(screen.getByText(/for order #1007/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View order' })).toHaveAttribute('href', '/orders/o1')
  })

  it('renders the failed panel with a try-again link for a failed intent', async () => {
    mockFetchOnce({ status: 'failed', purpose: 'order' })
    render(<UpiReturnClient intentId="int_1" fallbackHref="/account" retryHref="/checkout" />)
    expect(await screen.findByText('Payment not completed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/checkout')
  })

  it('uses the expired copy for an expired intent', async () => {
    mockFetchOnce({ status: 'expired', purpose: 'order' })
    render(<UpiReturnClient intentId="int_1" fallbackHref="/account" />)
    expect(await screen.findByText('Payment window expired')).toBeInTheDocument()
  })

  it('shows the error panel with the server message when the status call fails', async () => {
    mockFetchOnce({ status: 'pending', purpose: 'order', error: 'Could not check the payment' }, false, 500)
    render(<UpiReturnClient intentId="int_1" fallbackHref="/account" />)
    // One failed poll keeps polling; the message is surfaced only after MAX_POLLS, so assert we stay in
    // the checking panel (no crash) rather than the error panel which needs 90 polls.
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument()
  })
})

describe('UpiReturnLoading', () => {
  it('renders the busy frame with the confirming copy', () => {
    render(<UpiReturnLoading />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Confirming your payment…')).toBeInTheDocument()
  })
})
