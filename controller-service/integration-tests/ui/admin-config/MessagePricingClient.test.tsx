import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import MessagePricingClient from '@controller/app/(admin)/admin/ecom/configuration/MessagePricingClient'

const sheet = () => ({
  marginPct: 20,
  mediaInr: 0.5,
  rates: { 'twilio:sms': { costInr: 1, feeInr: 0.1, exact: false }, 'aws:sms': { costInr: 0.5, feeInr: 0, exact: false } },
})
const view = (over: Record<string, unknown> = {}) => ({
  sheet: sheet(),
  fx: { rate: 84.5, source: 'ecb', fetchedAt: '2026-11-24T00:00:00Z' },
  defaults: { ...sheet(), marginPct: 25 },
  rows: [
    { key: 'twilio:sms', provider: 'twilio', channel: 'sms', label: 'Twilio · SMS' },
    { key: 'aws:sms', provider: 'aws', channel: 'sms', label: 'AWS · SMS' },
  ],
  active: { sms: 'aws', whatsapp: 'twilio', email: 'ses' },
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
      <MessagePricingClient />
    </ToastProvider>,
  )
const cost = (row: number) => screen.getAllByRole('spinbutton')[3 + row * 2] as HTMLInputElement

describe('Admin MessagePricingClient', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows a placeholder, then the margin, live FX, and each provider row with what the store pays', async () => {
    mockFetch(view())
    const { container } = renderIt()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(await screen.findByText('Twilio · SMS')).toBeInTheDocument()
    expect(screen.getByText('₹84.50')).toBeInTheDocument()
    expect(screen.getByText('In use')).toBeInTheDocument()
    expect(screen.getByText('₹1.20')).toBeInTheDocument()
    expect(screen.getByText('₹0.60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save pricing' })).toBeDisabled()
  })

  it('recomputes the store price as the margin changes, only Twilio can use the provider price', async () => {
    mockFetch(view())
    renderIt()
    await screen.findByText('Twilio · SMS')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '100' } })
    expect(screen.getByText('₹2.00')).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0]).toBeEnabled()
    expect(boxes[1]).toBeDisabled()
    fireEvent.click(boxes[0])
    expect(screen.getByText('estimate; corrected on delivery')).toBeInTheDocument()
  })

  it('saves the edited sheet with a PUT and confirms', async () => {
    const f = mockFetch(view(), { ok: true, body: view({ sheet: { ...sheet(), marginPct: 30 } }) })
    renderIt()
    await screen.findByText('Twilio · SMS')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }))
    expect(await screen.findByText('Saved. New messages are priced with it within a minute.')).toBeInTheDocument()
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(put[0]).toBe('/api/admin/ecom/message-pricing')
    expect(JSON.parse(put[1].body).marginPct).toBe(30)
    expect(screen.getByRole('button', { name: 'Save pricing' })).toBeDisabled()
  })

  it('shows the server error when saving fails', async () => {
    mockFetch(view(), { ok: false, body: { error: 'Margin too high' } })
    renderIt()
    await screen.findByText('Twilio · SMS')
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }))
    expect(await screen.findByText('Margin too high')).toBeInTheDocument()
  })

  it('Discard changes restores the saved sheet and Defaults loads the default margin', async () => {
    mockFetch(view())
    renderIt()
    await screen.findByText('Twilio · SMS')
    const margin = screen.getAllByRole('spinbutton')[0] as HTMLInputElement
    fireEvent.change(margin, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(margin.value).toBe('20')
    fireEvent.click(screen.getByRole('button', { name: /Defaults/ }))
    expect(margin.value).toBe('25')
    expect(screen.getByRole('button', { name: 'Save pricing' })).toBeEnabled()
  })

  it('without write access the fields are disabled and there are no action buttons', async () => {
    canWrite = false
    mockFetch(view())
    renderIt()
    await screen.findByText('Twilio · SMS')
    expect(screen.getAllByRole('spinbutton')[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save pricing' })).toBeNull()
  })
})
