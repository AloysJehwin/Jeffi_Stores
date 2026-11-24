import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@controller/lib/compute/pricing', () => ({ quoteSpec: () => ({}), monthlyTotal: () => ({ total: 2345 }) }))

import ComputePricingClient from '@controller/app/(admin)/admin/ecom/configuration/ServerPricingClient'
import { SETTINGS } from '@controller/app/(admin)/admin/ecom/configuration/PricingLoading'

const settings = () => Object.fromEntries([...SETTINGS.map(s => [s.key, 1]), ['margin', 0.25], ['gstRate', 0.18]])
const view = (over: Record<string, unknown> = {}) => ({
  prices: [
    { code: 't4g.small', label: 't4g.small server', usdHourly: 0.0168, usdHourlyMultiAz: null, usdGbMonth: null, usdGbMonthMultiAz: null, sellable: true },
    { code: 'db.t4g.micro', label: 'Micro database', usdHourly: 0.016, usdHourlyMultiAz: 0.032, usdGbMonth: 0.115, usdGbMonthMultiAz: 0.23, sellable: false },
  ],
  fx: { rate: 84, source: 'ecb', fetchedAt: '2026-11-24T00:00:00Z' },
  settings: settings(),
  plans: [
    { slug: 'basic', name: 'Basic', tier: 1, monthlyPriceInr: 999, infraMargin: 0.2, rdsMargin: null, minPreset: 'small', defaultPreset: 'small' },
    { slug: 'pro', name: 'Pro', tier: 3, monthlyPriceInr: 2999, infraMargin: 0.3, rdsMargin: 0.4, minPreset: null, defaultPreset: null },
  ],
  presets: [{ key: 'small', label: 'Small', awsInrMonth: 1500, plans: { basic: { infraInrMonth: 1800, totalInrMonth: 2800 }, pro: null } }],
  ...over,
})
const mockFetch = (get: any, patch?: { ok: boolean; body: any }) => {
  const f = vi.fn<(...a: any[]) => any>(async (_u: string, init?: any) => {
    if (init?.method === 'PATCH') return { ok: patch?.ok ?? true, json: async () => patch?.body ?? get }
    return { ok: true, json: async () => get }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const renderIt = () =>
  render(
    <ToastProvider>
      <ComputePricingClient />
    </ToastProvider>,
  )
const patchBody = (f: any) => JSON.parse(f.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH')![1].body)

describe('Admin ServerPricingClient', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows the size price grid per plan, with the infra + GST + fee note', async () => {
    mockFetch(view())
    renderIt()
    expect(await screen.findByText('Basic / month')).toBeInTheDocument()
    expect(screen.getByText('Small')).toBeInTheDocument()
    expect(screen.getByText('₹1,500')).toBeInTheDocument()
    expect(screen.getByText('₹2,800')).toBeInTheDocument()
    expect(screen.getByText('infra ₹1,800 + GST + fee')).toBeInTheDocument()
  })

  it('shows plan margins as percents with an example price at the typed margin', async () => {
    mockFetch(view())
    renderIt()
    await screen.findByText('Basic / month')
    expect((screen.getByLabelText(/^All plans/) as HTMLInputElement).value).toBe('25')
    expect(screen.getAllByText(/\/mo$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Small: ₹2,345/mo').length).toBeGreaterThan(0)
  })

  it('saves a plan margin as a fraction on blur', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    const own = screen.getAllByLabelText(/^On its own server/)[0]
    fireEvent.change(own, { target: { value: '35' } })
    fireEvent.blur(own)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(patchBody(f)).toEqual({ plan: 'basic', infraMargin: 0.35 })
  })

  it('saves the default margin, and reverts an out-of-range one without a request', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    const all = screen.getByLabelText(/^All plans/) as HTMLInputElement
    fireEvent.change(all, { target: { value: '500' } })
    fireEvent.blur(all)
    expect(all.value).toBe('25')
    expect(f.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(false)
    fireEvent.change(all, { target: { value: '30' } })
    fireEvent.blur(all)
    await vi.waitFor(() => expect(patchBody(f)).toEqual({ settings: { margin: 0.3 } }))
  })

  it('saves a blank RDS margin as null', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    const rds = screen.getAllByLabelText(/^With RDS/)[1]
    fireEvent.change(rds, { target: { value: '' } })
    fireEvent.blur(rds)
    await vi.waitFor(() => expect(patchBody(f)).toEqual({ plan: 'pro', rdsMargin: null }))
  })

  it('edits a plan fee, committing on Enter', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    const fee = screen.getAllByLabelText('Plan fee per month')[0]
    fireEvent.change(fee, { target: { value: '1099' } })
    fireEvent.keyDown(fee, { key: 'Enter' })
    await vi.waitFor(() => expect(patchBody(f)).toEqual({ plan: 'basic', monthlyPriceInr: 1099 }))
  })

  it('edits a USD price and toggles whether a resource is offered', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    const hourly = screen.getAllByDisplayValue('0.0168')[0]
    fireEvent.change(hourly, { target: { value: '0.02' } })
    fireEvent.blur(hourly)
    await vi.waitFor(() => expect(patchBody(f)).toEqual({ code: 't4g.small', usd_hourly: 0.02 }))
    fireEvent.click(screen.getAllByLabelText('Offered')[1])
    await vi.waitFor(() => expect(f.mock.calls.filter(c => c[1]?.method === 'PATCH')).toHaveLength(2))
    expect(JSON.parse(f.mock.calls.filter(c => c[1]?.method === 'PATCH')[1][1].body)).toEqual({ code: 'db.t4g.micro', sellable: true })
  })

  it('saves all settings as numbers', async () => {
    const f = mockFetch(view(), { ok: true, body: view() })
    renderIt()
    await screen.findByText('Basic / month')
    fireEvent.change(screen.getByText('Server disk (GB)').parentElement!.querySelector('input')!, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await vi.waitFor(() => expect(patchBody(f).settings.rootVolumeGb).toBe(50))
    expect(typeof patchBody(f).settings.gstRate).toBe('number')
  })

  it('shows the server error when a save fails', async () => {
    mockFetch(view(), { ok: false, body: { error: 'Margin out of range' } })
    renderIt()
    await screen.findByText('Basic / month')
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByText('Margin out of range')).toBeInTheDocument()
  })

  it('without write access everything is read-only', async () => {
    canWrite = false
    mockFetch(view())
    renderIt()
    await screen.findByText('Basic / month')
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    expect(screen.queryByLabelText('Plan fee per month')).toBeNull()
    expect(screen.getByText('₹999')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Offered')[0]).toBeDisabled()
  })
})
