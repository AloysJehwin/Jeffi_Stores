import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => ({ whatsapp: true, push: true, sms: true, email: true }) }))
vi.mock('@/components/admin/campaigns/CampaignSkeletons', () => ({ CampaignCardListSkeleton: () => <div>skeleton</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/scenarios/_components/ScenariosMobileList', () => ({ default: () => <div>mobile-list</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/campaign-presentation', () => ({ channelParamOff: () => false }))

import ScenariosListClient from '@admin/app/(admin)/admin/campaigns/scenarios/ScenariosListClient'

const stats = (over: Record<string, unknown> = {}) => ({ campaigns_count: 0, total_sent: 1000, total_opened: 400, total_clicked: 100, total_converted: 25, last_run_at: null, ...over })
const scenarios = [
  {
    kind: 'cart_recovery',
    name: 'Cart recovery',
    description: 'Win back carts',
    trigger: 'A cart sits for 4 hours',
    type: 'builtin',
    enabled: true,
    default_parameters: { delay_hours: 4 },
    param_schema: { delay_hours: { type: 'number', label: 'Delay hours' } },
    stats: stats({ campaigns_count: 2 }),
    campaigns: [{ scenario_kind: 'cart_recovery', kind: 'cart_a', name: 'Cart A', enabled: true, delay_hours: 4, discount_percent: 0, last_run_at: null }],
  },
  {
    kind: 'my_scenario',
    name: 'My scenario',
    description: 'Custom flow',
    trigger: 'Manual',
    type: 'custom',
    enabled: false,
    default_parameters: {},
    param_schema: {},
    stats: stats({ total_sent: 0, total_opened: 0, total_clicked: 0, total_converted: 0 }),
    campaigns: [],
  },
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('ScenariosListClient', () => {
  beforeEach(() => {
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method ? json(true) : json(true, { scenarios })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a skeleton, then scenario cards with type, stats and linked campaigns', async () => {
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    expect(screen.getByText('skeleton')).toBeInTheDocument()
    expect(await screen.findByText('Cart recovery')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaigns/scenarios', { credentials: 'include' })
    expect(screen.getByText('Built-in')).toBeInTheDocument()
    expect(screen.getByText('Custom')).toBeInTheDocument()
    expect(screen.getByText('2 campaigns')).toBeInTheDocument()
    expect(screen.getByText('A cart sits for 4 hours')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cart A' })).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/cart_a'))
    expect(screen.getAllByRole('link', { name: 'Configure' })[0]).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/scenarios/cart_recovery'))
    expect(screen.getAllByText('Never').length).toBeGreaterThan(0)
    expect(screen.getByText('Default parameters (1)')).toBeInTheDocument()
  })

  it('activates a paused custom scenario', async () => {
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Scenario activated', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/campaigns/scenarios/my_scenario')
    expect(JSON.parse(patch[1].body)).toEqual({ enabled: true })
  })

  it('toasts the server error when the toggle fails', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method ? json(false, { error: 'Locked' }) : json(true, { scenarios })))
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Locked', 'error'))
  })

  it('deletes an unused custom scenario after confirming', async () => {
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Scenario deleted', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete scenario?' }))
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE' && c[0] === '/api/admin/campaigns/scenarios/my_scenario')).toBe(true)
  })

  it('does not delete when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(false)
  })

  it('built-in scenarios have no pause or delete controls', async () => {
    render(asAdmin(<ScenariosListClient />, ['campaigns:write']))
    await screen.findByText('Cart recovery')
    expect(screen.getAllByRole('button', { name: /Activate|Pause/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: '+ New campaign' })).toHaveLength(2)
  })

  it('hides write controls without campaigns write', async () => {
    render(asMember(<ScenariosListClient />, ['campaigns:read']))
    await screen.findByText('Cart recovery')
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ New campaign' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Configure' }).length).toBe(2)
  })
})
