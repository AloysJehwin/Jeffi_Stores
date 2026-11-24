import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

import SubscribeClient from '@controller/app/(ecom)/ecom/dashboard/billing/subscribe/SubscribeClient'

const view = () =>
  render(
    <ToastProvider>
      <SubscribeClient tenantSlug="acme store" />
    </ToastProvider>,
  )
const original = window.location

describe('SubscribeClient', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: original, writable: true })
  })

  it('starts the subscription for the tenant, toasts and sends the owner to Razorpay', async () => {
    const loc = { href: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true })
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true, json: async () => ({ checkoutUrl: 'https://rzp.io/sub_1' }) })
    vi.stubGlobal('fetch', f)
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Razorpay' }))
    expect(screen.getByRole('button', { name: 'Opening Razorpay…' })).toBeDisabled()
    expect(await screen.findByText('Opening Razorpay to approve your subscription…')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/billing/subscribe?tenant=acme%20store')
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(loc.href).toBe('https://rzp.io/sub_1')
  })

  it('shows the API error and re-enables the button when no checkout URL comes back', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false, json: async () => ({ error: 'Plan not found' }) }))
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Razorpay' }))
    expect(await screen.findByText('Plan not found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to Razorpay' })).toBeEnabled()
  })

  it('shows a network error', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('offline')))
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Razorpay' }))
    expect(await screen.findByText('Network error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to Razorpay' })).toBeEnabled()
  })
})
