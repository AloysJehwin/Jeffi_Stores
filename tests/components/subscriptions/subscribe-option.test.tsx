import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'

const push = vi.fn()
const flags = { subscriptionsEnabled: true }
const auth: { user: unknown } = { user: { id: 'u1' } }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

import SubscribeOption, { type PurchaseMode } from '@/components/subscriptions/SubscribeOption'

function Harness(props: { isSubscription?: boolean; digital?: boolean; intervals?: string[] }) {
  const [mode, setMode] = useState<PurchaseMode>('once')
  return (
    <SubscribeOption
      productId="p1"
      variantId={null}
      subVariantId={null}
      isSubscription={props.isSubscription ?? true}
      intervals={props.intervals ?? ['monthly', 'quarterly']}
      digital={props.digital ?? false}
      mode={mode}
      onModeChange={setMode}
    />
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  flags.subscriptionsEnabled = true
  auth.user = { id: 'u1' }
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ unitPrice: 500, quantity: 1, shipping: 0, amount: 500, intervalLabel: 'Monthly' }),
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SubscribeOption visibility', () => {
  it('hidden when the master switch is off', () => {
    flags.subscriptionsEnabled = false
    render(<Harness />)
    expect(screen.queryByTestId('subscribe-option')).toBeNull()
  })

  it('hidden when the product is not a subscription', () => {
    render(<Harness isSubscription={false} />)
    expect(screen.queryByTestId('subscribe-option')).toBeNull()
  })

  it('hidden when no valid intervals are configured', () => {
    render(<Harness intervals={['daily']} />)
    expect(screen.queryByTestId('subscribe-option')).toBeNull()
  })

  it('shown when master and product flags are on', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Subscribe' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SubscribeOption subscribe mode', () => {
  it('quotes the selected interval and renders the per-cycle price', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByTestId('subscribe-quote').textContent).toContain('₹500.00'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/subscriptions/quote')
    expect(JSON.parse(init.body)).toMatchObject({ productId: 'p1', interval: 'monthly', quantity: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Every 3 months' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).interval).toBe('quarterly')
  })

  it('shows the quote error (e.g. over the cap)', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Subscriptions are limited to ₹15,000 per cycle' }) })
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByTestId('subscribe-quote').textContent).toContain('₹15,000'))
  })

  it('navigates to /subscribe with interval and qty', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    fireEvent.change(screen.getByLabelText('Quantity per cycle'), { target: { value: '3' } })
    await waitFor(() => expect(screen.getByTestId('subscribe-quote').textContent).toContain('₹'))
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(push).toHaveBeenCalledWith('/subscribe?product=p1&interval=monthly&qty=3')
  })

  it('digital: no quantity picker, qty fixed at 1', async () => {
    render(<Harness digital />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    expect(screen.queryByLabelText('Quantity per cycle')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).quantity).toBe(1)
  })

  it('anonymous users see a sign-in hint and no quote call', () => {
    auth.user = null
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    expect(screen.getByTestId('subscribe-quote').textContent).toContain('Sign in')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SubscribeOption comparison & term', () => {
  it('shows the saving vs one-time and a fixed term with minimum', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        unitPrice: 450,
        oneTimePrice: 500,
        totalCycles: 12,
        minCycles: 3,
        quantity: 1,
        shipping: 0,
        amount: 450,
        intervalLabel: 'Monthly',
      }),
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByTestId('subscribe-savings').textContent).toContain('Save 10% vs one-time'))
    expect(screen.getByTestId('subscribe-term').textContent).toBe('12 deliveries, then it ends · Minimum 3 charges')
  })

  it('shows no saving when not cheaper, and "Until you cancel" by default', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ unitPrice: 500, oneTimePrice: 500, quantity: 1, shipping: 0, amount: 500, intervalLabel: 'Monthly' }),
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByTestId('subscribe-term').textContent).toBe('Until you cancel'))
    expect(screen.queryByTestId('subscribe-savings')).toBeNull()
  })
})
