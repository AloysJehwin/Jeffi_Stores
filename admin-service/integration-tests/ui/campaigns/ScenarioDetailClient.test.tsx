import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => ({ whatsapp: false, push: true, sms: true, email: true }) }))
vi.mock('@admin/app/(admin)/admin/campaigns/scenarios/_components/ScenarioLoading', () => ({ ScenarioDetailLoading: () => <div>scenario-loading</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/campaign-presentation', () => ({
  channelParamOff: (k: string) => k === 'also_whatsapp',
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="bool-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/campaigns/DurationField', () => ({
  default: ({ canonicalMinutes, onChange }: any) => (
    <button onClick={() => onChange(90)}>duration:{String(canonicalMinutes)}</button>
  ),
}))

import ScenarioDetailClient from '@admin/app/(admin)/admin/campaigns/scenarios/[kind]/ScenarioDetailClient'

const scenario = {
  kind: 'cart_abandon',
  name: 'Cart abandon',
  description: 'Left items behind',
  trigger: 'Cart idle for a day',
  default_parameters: { lookback_days: 7, free_ship: true, wait: 60, also_whatsapp: true },
  param_schema: {
    lookback_days: { type: 'integer', label: 'Lookback days', min: 1, max: 30, description: 'How far back' },
    free_ship: { type: 'boolean', label: 'Free shipping' },
    wait: { type: 'duration', label: 'Wait', recommendedUnit: 'hours' },
    also_whatsapp: { type: 'boolean', label: 'Also send via WhatsApp' },
  },
}
const camp = (over: Record<string, unknown> = {}) => ({
  kind: 'cart_1', name: 'Cart nudge', description: 'First nudge', enabled: true, delay_hours: 2, discount_percent: 10,
  parameters: { lookback_days: 14 }, last_run_at: null, total_sent: 1200, total_opened: 600, total_clicked: 120, total_converted: 30, ...over,
})
const fetchMock = vi.fn()
const setup = (body: any, ok = true) => {
  fetchMock.mockImplementation(async (_url: string, init?: any) => {
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({}) }
    return { ok, json: async () => body }
  })
}

describe('ScenarioDetailClient', () => {
  beforeEach(() => {
    showToast.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows loading, then scenario info, defaults (hiding off-channel params) and campaign stats', async () => {
    setup({ scenario, campaigns: [camp()] })
    render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    expect(screen.getByText('scenario-loading')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Cart abandon' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaigns/scenarios/cart_abandon', { credentials: 'include' })
    expect(screen.getByText('Cart idle for a day')).toBeInTheDocument()
    expect(screen.getByText('lookback_days')).toBeInTheDocument()
    expect(screen.queryByText('also_whatsapp')).not.toBeInTheDocument()
    expect(screen.queryByText('Also send via WhatsApp')).not.toBeInTheDocument()
    expect(screen.getByText('Campaigns using this scenario (1)')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('10% off')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.getByText('2.5%')).toBeInTheDocument()
    expect(screen.getByText('OVERRIDDEN')).toBeInTheDocument()
    expect(screen.getByText('Range: 1 to 30')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit template' })).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/cart_1'))
  })

  it('shows dashes for rates when nothing was sent, and the paused badge', async () => {
    setup({ scenario, campaigns: [camp({ enabled: false, total_sent: 0, discount_percent: 0 })] })
    render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    await screen.findByText('Paused')
    expect(screen.getAllByText('—').length).toBe(3)
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
  })

  it('shows the empty state with a create link for writers only', async () => {
    setup({ scenario, campaigns: [] })
    const { unmount } = render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    expect(await screen.findByText('No campaigns are using this scenario yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create the first one' })).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/new?scenario=cart_abandon'))
    unmount()
    render(asMember(<ScenarioDetailClient kind="cart_abandon" />, ['campaigns:read']))
    await screen.findByText('No campaigns are using this scenario yet.')
    expect(screen.queryByRole('link', { name: 'Create the first one' })).not.toBeInTheDocument()
  })

  it('toasts and shows not-found when the scenario fails to load', async () => {
    setup({}, false)
    render(asAdmin(<ScenarioDetailClient kind="nope" />))
    expect(await screen.findByText('Scenario not found.')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Scenario not found', 'error')
  })

  it('saves edited overrides (number, boolean, duration) with the right PATCH body', async () => {
    setup({ scenario, campaigns: [camp()] })
    render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    await screen.findByText('Cart nudge')
    fireEvent.change(screen.getByPlaceholderText('Default: 7'), { target: { value: '21' } })
    fireEvent.change(screen.getByLabelText('bool-select'), { target: { value: 'false' } })
    fireEvent.click(screen.getByRole('button', { name: /duration:/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save overrides' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Parameters saved', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/campaigns/cart_1')
    expect(JSON.parse(patch[1].body)).toEqual({ parameters: { lookback_days: 21, free_ship: false, wait: 90 } })
  })

  it('clearing a field removes the override, and Reset clears them all', async () => {
    setup({ scenario, campaigns: [camp()] })
    render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    await screen.findByText('OVERRIDDEN')
    fireEvent.change(screen.getByPlaceholderText('Default: 7'), { target: { value: '' } })
    expect(screen.queryByText('OVERRIDDEN')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Default: 7'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save overrides' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')![1].body)).toEqual({ parameters: {} })
  })

  it('toasts the server error when saving fails and hides save without write access', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: any) =>
      init?.method === 'PATCH' ? { ok: false, json: async () => ({ error: 'Out of range' }) } : { ok: true, json: async () => ({ scenario, campaigns: [camp()] }) })
    const { unmount } = render(asAdmin(<ScenarioDetailClient kind="cart_abandon" />))
    await screen.findByText('Cart nudge')
    fireEvent.click(screen.getByRole('button', { name: 'Save overrides' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Out of range', 'error'))
    unmount()
    render(asMember(<ScenarioDetailClient kind="cart_abandon" />, ['campaigns:read']))
    await screen.findByText('Cart nudge')
    expect(screen.queryByRole('button', { name: 'Save overrides' })).not.toBeInTheDocument()
  })
})
