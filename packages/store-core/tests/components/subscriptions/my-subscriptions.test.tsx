import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const push = vi.fn()
const showToast = vi.fn()
const confirm = vi.fn()
const auth: { user: unknown; isLoading: boolean } = { user: { id: 'u1' }, isLoading: false }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/visitor/AccountMobileHeader', () => ({ default: () => null }))
vi.mock('@/components/business/AccountMobileHeader', () => ({ default: () => null }))

import { MySubscriptions, type SubscriptionItem } from '@/components/subscriptions/MySubscriptions'

const base: SubscriptionItem = {
  id: 's1',
  status: 'active',
  statusLabel: 'Active',
  productId: 'p1',
  productName: 'Coffee beans',
  productSlug: 'coffee-beans',
  imageUrl: null,
  isDigital: false,
  interval: 'monthly',
  intervalLabel: 'Monthly',
  quantity: 2,
  amount: 850,
  currentEnd: '2026-11-07T00:00:00Z',
  nextChargeAt: '2026-11-07T00:00:00Z',
  cancelAtCycleEnd: false,
  accessExpiresAt: null,
  address: { name: 'Asha', line1: '1 Main St', city: 'Chennai', state: 'TN', pincode: '600001' },
  orders: [{ id: 'o1', orderNumber: 'ORD-1', status: 'confirmed', total: 850, createdAt: '2026-10-07T00:00:00Z', cycle: 1 }],
}

const fetchMock = vi.fn()
let list: SubscriptionItem[]

const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body })

beforeEach(() => {
  list = [base]
  confirm.mockResolvedValue(true)
  fetchMock.mockReset()
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/user/subscriptions') return json({ subscriptions: list })
    if (url === '/api/user/addresses') return json({ addresses: [{ id: 'a2', full_name: 'Office', city: 'Pune', postal_code: '411001' }] })
    if (url === '/api/user/subscriptions/s1') {
      const { action } = JSON.parse(String(init?.body))
      const next =
        action === 'pause'
          ? { ...base, status: 'paused', statusLabel: 'Paused' }
          : action === 'resume'
            ? { ...base, status: 'active', statusLabel: 'Active' }
            : action === 'cancel'
              ? { ...base, cancelAtCycleEnd: true }
              : { ...base, address: { ...base.address!, city: 'Pune' } }
      return json({ subscription: next })
    }
    return json({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const actionCall = () => {
  const c = fetchMock.mock.calls.find(c => c[0] === '/api/user/subscriptions/s1')!
  return { init: c[1], body: JSON.parse(c[1].body) }
}

describe('MySubscriptions', () => {
  it('lists subscriptions with status, next charge and cycle orders', async () => {
    render(<MySubscriptions isBusiness={false} />)
    await waitFor(() => expect(screen.getByText('Coffee beans')).toBeTruthy())
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText(/Next charge/)).toBeTruthy()
    expect(screen.getByText('Cycle 1 · ORD-1').getAttribute('href')).toBe('/account/orders/o1')
  })

  it('shows "Cycle k of N" for a fixed-term subscription', async () => {
    list = [{ ...base, currentCycle: 2, totalCycles: 12 }]
    render(<MySubscriptions isBusiness={false} />)
    await waitFor(() => expect(screen.getByText(/Cycle 2 of 12/)).toBeTruthy())
  })

  it('disables Cancel and Pause until the minimum commitment is met', async () => {
    list = [{ ...base, currentCycle: 2, minCycles: 6 }]
    render(<MySubscriptions isBusiness={false} />)
    const cancel = (await screen.findByRole('button', { name: 'Cancel' })) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('subscription-commitment').textContent).toContain('after charge 6 (2 paid')
  })

  it('enables Cancel once the minimum is met', async () => {
    list = [{ ...base, currentCycle: 6, minCycles: 6 }]
    render(<MySubscriptions isBusiness={false} />)
    const cancel = (await screen.findByRole('button', { name: 'Cancel' })) as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    expect(screen.queryByTestId('subscription-commitment')).toBeNull()
  })

  it('pause confirms then POSTs the pause action and updates the card', async () => {
    render(<MySubscriptions isBusiness={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy())
    expect(confirm).toHaveBeenCalled()
    expect(actionCall().body).toEqual({ action: 'pause' })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('does nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false)
    render(<MySubscriptions isBusiness={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/user/subscriptions/s1')).toBe(false)
  })

  it('cancel POSTs cancel and shows the end date instead of the cancel button', async () => {
    render(<MySubscriptions isBusiness={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull())
    expect(actionCall().body).toEqual({ action: 'cancel' })
    expect(screen.getByText(/^Ends /)).toBeTruthy()
  })

  it('resume on a paused subscription', async () => {
    list = [{ ...base, status: 'paused', statusLabel: 'Paused' }]
    render(<MySubscriptions isBusiness={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(actionCall().body).toEqual({ action: 'resume' }))
  })

  it('change address posts the chosen address id', async () => {
    render(<MySubscriptions isBusiness={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change address' }))
    fireEvent.click(await screen.findByRole('button', { name: /Office/ }))
    await waitFor(() => expect(actionCall().body).toEqual({ action: 'address', addressId: 'a2' }))
  })

  it('digital subscriptions have no change-address action', async () => {
    list = [{ ...base, isDigital: true, address: null }]
    render(<MySubscriptions isBusiness={false} />)
    await screen.findByRole('button', { name: 'Pause' })
    expect(screen.queryByRole('button', { name: 'Change address' })).toBeNull()
  })

  it('business portal sends the X-Auth-Portal header', async () => {
    render(<MySubscriptions isBusiness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(actionCall().init.headers['X-Auth-Portal']).toBe('business'))
  })
})
