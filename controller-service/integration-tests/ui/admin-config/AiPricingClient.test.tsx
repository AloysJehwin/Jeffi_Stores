import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import AiPricingClient from '@controller/app/(admin)/admin/settings/ai-pricing/AiPricingClient'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', capability: 'text', provider: 'razer', model: '*', unit_type: 'token_1k_in', cost_inr: 0.5, price_inr: 1, active: true, updated_at: '2026-11-20T00:00:00Z', ...over,
})
const rows = () => [
  row(),
  row({ id: 'r2', capability: 'image', provider: 'openai', model: 'gpt-image', unit_type: 'image', cost_inr: 3, price_inr: 3.3 }),
  row({ id: 'r3', capability: 'video', provider: 'veo', model: '*', unit_type: 'video_second', cost_inr: 5, price_inr: 0, active: false }),
]
function mockFetch(list: any, extra?: { patch?: { ok: boolean; body: any }; post?: { ok: boolean; body: any } }) {
  const f = vi.fn<(...a: any[]) => any>(async (_u: string, init?: any) => {
    if (init?.method === 'PATCH') return { ok: extra?.patch?.ok ?? true, json: async () => extra?.patch?.body ?? { row: row() } }
    if (init?.method === 'POST') return { ok: extra?.post?.ok ?? true, json: async () => extra?.post?.body ?? { row: row({ id: 'r9', provider: 'newco' }) } }
    if (!Array.isArray(list)) return { ok: false, json: async () => list }
    return { ok: true, json: async () => ({ rows: list }) }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const renderIt = () =>
  render(
    <ToastProvider>
      <AiPricingClient />
    </ToastProvider>,
  )

describe('Admin AiPricingClient', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('lists every price with provider, unit and margin badges (green, free)', async () => {
    mockFetch(rows())
    renderIt()
    expect(await screen.findByText('razer')).toBeInTheDocument()
    expect(screen.getAllByText('default').length).toBe(2)
    expect(screen.getByText('gpt-image')).toBeInTheDocument()
    expect(screen.getByText('per 1k input tokens')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('filters by capability tab and shows an empty message', async () => {
    mockFetch(rows())
    renderIt()
    await screen.findByText('razer')
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }))
    expect(screen.getByText('openai')).toBeInTheDocument()
    expect(screen.queryByText('razer')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Embeddings' }))
    expect(screen.getByText('No prices for this capability.')).toBeInTheDocument()
  })

  it('reports a load failure', async () => {
    mockFetch({ error: 'Not allowed to read prices' })
    renderIt()
    expect(await screen.findByText('Not allowed to read prices')).toBeInTheDocument()
  })

  it('saves an edited price on blur and shows Saved', async () => {
    const f = mockFetch(rows(), { patch: { ok: true, body: { row: row({ price_inr: 2 }) } } })
    renderIt()
    await screen.findByText('razer')
    const price = screen.getAllByLabelText('Amount in INR')[1]
    fireEvent.change(price, { target: { value: '2' } })
    fireEvent.blur(price)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    const patch = f.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/ecom/ai-pricing')
    expect(JSON.parse(patch[1].body)).toEqual({ id: 'r1', price_inr: 2 })
    expect(await screen.findByText('75.0%')).toBeInTheDocument()
  })

  it('does not call the API when the value is unchanged or invalid', async () => {
    const f = mockFetch(rows())
    renderIt()
    await screen.findByText('razer')
    const cost = screen.getAllByLabelText('Amount in INR')[0] as HTMLInputElement
    fireEvent.blur(cost)
    fireEvent.change(cost, { target: { value: '-4' } })
    fireEvent.blur(cost)
    expect(cost.value).toBe('0.5')
    expect(f.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
  })

  it('toggles a price active with a PATCH and shows an update failure', async () => {
    const f = mockFetch(rows(), { patch: { ok: false, body: { error: 'Locked price' } } })
    renderIt()
    await screen.findByText('razer')
    fireEvent.click(screen.getAllByLabelText('Active')[0])
    expect(await screen.findByText('Locked price')).toBeInTheDocument()
    expect(JSON.parse(f.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ id: 'r1', active: false })
  })

  it('adds a row: provider required, then POSTs numbers and appends it', async () => {
    const f = mockFetch(rows())
    renderIt()
    await screen.findByText('razer')
    fireEvent.click(screen.getByRole('button', { name: /Add row/ }))
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('razer'), { target: { value: 'newco' } })
    const cost = screen.getByText('Cost (INR)').parentElement!.querySelector('input') as HTMLInputElement
    fireEvent.change(cost, { target: { value: '1.5' } })
    expect(add).toBeEnabled()
    fireEvent.click(add)
    expect(await screen.findByText('Row added')).toBeInTheDocument()
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ provider: 'newco', capability: 'image', unit_type: 'image', model: '*', cost_inr: 1.5, price_inr: 0 })
    expect(screen.getByText('newco')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
  })

  it('shows the add error and Cancel closes the form', async () => {
    mockFetch(rows(), { post: { ok: false, body: { error: 'Duplicate price' } } })
    renderIt()
    await screen.findByText('razer')
    fireEvent.click(screen.getByRole('button', { name: /Add row/ }))
    fireEvent.change(screen.getByPlaceholderText('razer'), { target: { value: 'razer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Duplicate price')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('razer')).toBeNull()
  })

  it('without write access prices are read-only text', async () => {
    canWrite = false
    mockFetch(rows())
    renderIt()
    await screen.findByText('razer')
    expect(screen.queryByLabelText('Amount in INR')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add row/ })).toBeNull()
    expect(screen.getAllByLabelText('Active')[0]).toBeDisabled()
    expect(within(screen.getAllByRole('row')[1]).getByText('₹0.50')).toBeInTheDocument()
  })
})
