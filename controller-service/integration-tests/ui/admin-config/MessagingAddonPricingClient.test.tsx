import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import MessagingAddonPricingClient from '@controller/app/(admin)/admin/ecom/configuration/MessagingAddonPricingClient'

const view = (over: Record<string, unknown> = {}) => ({
  costLines: [{ label: 'SMS number', inrMonth: 100 }, { label: 'WhatsApp number', inrMonth: 150 }],
  marginPct: 40,
  costInr: 250,
  priceInr: 350,
  defaults: { costLines: [], marginPct: 40 },
  ...over,
})
const mockFetch = (get: any, put?: { ok: boolean; body: any }) => {
  const f = vi.fn<(...a: any[]) => any>(async (_u: string, init?: any) => {
    if (init?.method === 'PUT') return { ok: put?.ok ?? true, json: async () => put?.body ?? get }
    return { ok: true, json: async () => get }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const renderIt = () =>
  render(
    <ToastProvider>
      <MessagingAddonPricingClient />
    </ToastProvider>,
  )

describe('Admin MessagingAddonPricingClient', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows a placeholder, then the cost lines and the monthly price per store', async () => {
    mockFetch(view())
    const { container } = renderIt()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('SMS number')).toBeInTheDocument()
    expect(screen.getByDisplayValue('WhatsApp number')).toBeInTheDocument()
    expect(screen.getByText(/Cost ₹250 \+ 40% =/)).toHaveTextContent('₹350/month per store')
  })

  it('recomputes the price, rounding up to the rupee, and shows the current fee while it differs', async () => {
    mockFetch(view())
    renderIt()
    await screen.findByDisplayValue('SMS number')
    fireEvent.change(screen.getAllByLabelText('Monthly amount (₹)')[0], { target: { value: '101.5' } })
    expect(screen.getByText(/Cost ₹251.5 \+ 40% =/)).toHaveTextContent('₹353/month per store (now ₹350)')
  })

  it('adds and removes cost lines', async () => {
    mockFetch(view())
    renderIt()
    await screen.findByDisplayValue('SMS number')
    fireEvent.click(screen.getByRole('button', { name: /Add cost/ }))
    expect(screen.getAllByLabelText('Cost')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getAllByTitle('Remove')[2])
    expect(screen.getAllByLabelText('Cost')).toHaveLength(2)
    fireEvent.click(screen.getAllByTitle('Remove')[0])
    expect(screen.queryByTitle('Remove')).toBeNull()
  })

  it('saves the trimmed lines and margin and confirms the new fee', async () => {
    const f = mockFetch(view(), { ok: true, body: view({ priceInr: 400 }) })
    renderIt()
    await screen.findByDisplayValue('SMS number')
    fireEvent.change(screen.getAllByLabelText('Cost')[0], { target: { value: '  Bigger SMS number ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. Stores now pay ₹400/month; current months renew at the new fee.')).toBeInTheDocument()
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(put[0]).toBe('/api/admin/ecom/messaging-addon-pricing')
    expect(JSON.parse(put[1].body)).toEqual({ costLines: [{ label: 'Bigger SMS number', inrMonth: 100 }, { label: 'WhatsApp number', inrMonth: 150 }], marginPct: 40 })
  })

  it('shows the server error when saving fails', async () => {
    mockFetch(view(), { ok: false, body: { error: 'Invalid cost line' } })
    renderIt()
    await screen.findByDisplayValue('SMS number')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Invalid cost line')).toBeInTheDocument()
  })

  it('without write access it is read-only', async () => {
    canWrite = false
    mockFetch(view())
    renderIt()
    expect(await screen.findByDisplayValue('SMS number')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add cost/ })).toBeNull()
  })
})
