import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/campaigns' }))
vi.mock('@/components/admin/export/ExportButton', () => ({ ExportButton: () => <button type="button">Export</button> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => ({ whatsapp: true, push: false, sms: false, email: true }) }))
vi.mock('@/components/admin/campaigns/CampaignSkeletons', () => ({ CampaignCardListSkeleton: () => <div>drafts-skeleton</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/CampaignsListLoading', () => ({ default: () => <div>list-skeleton</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/CampaignsMobileList', () => ({ default: () => <div>mobile-list</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/campaign-presentation', () => ({
  getChannels: (kind: string) => (kind === 'wa_only' ? ['whatsapp'] : ['email']),
  ChannelChip: ({ channel }: any) => <span>chip:{channel}</span>,
  rate: () => 0,
  CampaignStatsGrid: () => <div>stats</div>,
}))
vi.mock('@/components/admin/RowActions', () => ({
  default: ({ actions }: any) => (
    <div>
      {actions.map((a: any) => (a.href ? <a key={a.key} href={a.href}>{a.label}</a> : <button key={a.key} disabled={a.disabled} onClick={() => a.onSelect()}>{a.label}</button>))}
    </div>
  ),
}))

import CampaignsListClient from '@admin/app/(admin)/admin/campaigns/CampaignsListClient'

const row = (over: Record<string, unknown> = {}) => ({
  kind: 'abandoned_cart',
  name: 'Abandoned cart',
  description: 'Nudge shoppers',
  enabled: true,
  delay_hours: 4,
  discount_percent: 10,
  last_run_at: null,
  draft_fields: null,
  parameters: {},
  ...over,
})
const campaigns = [
  row(),
  row({ kind: 'win_back', name: 'Win back', description: 'Lapsed customers', enabled: false, discount_percent: 0 }),
  row({ kind: 'wa_only', name: 'WA reminder', description: null }),
  row({ kind: 'broadcast', name: 'Broadcast' }),
  row({ kind: 'birthday', name: 'Birthday', draft_fields: { name: 'x' }, draft_lock: null }),
]
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
const fetchMock = vi.fn()

describe('CampaignsListClient', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    confirm.mockResolvedValue(true)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => (init?.method ? json(true, { totalSent: 7 }) : json(true, { campaigns, total: campaigns.length })))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a skeleton, then every non-broadcast campaign with status, chips, discount and last run', async () => {
    render(asAdmin(<CampaignsListClient />))
    expect(screen.getByText('list-skeleton')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Abandoned cart' })).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/abandoned_cart/view'))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/admin/campaigns?limit=20&offset=0')
    expect(screen.queryByText('Broadcast')).not.toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getAllByText('10% off').length).toBeGreaterThan(0)
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
    expect(screen.getAllByText(/Last run: never/).length).toBeGreaterThan(0)
  })

  it('filters by search text and shows the result count', async () => {
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Win back' })
    fireEvent.change(screen.getByPlaceholderText('Search campaigns...'), { target: { value: 'lapsed' } })
    expect(screen.queryByRole('link', { name: 'Abandoned cart' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Win back' })).toBeInTheDocument()
    expect(screen.getByText(/1 campaign found/)).toBeInTheDocument()
  })

  it('filters by status and channel, and shows the empty state', async () => {
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Win back' })
    fireEvent.click(screen.getByRole('button', { name: 'paused' }))
    expect(screen.queryByRole('link', { name: 'Abandoned cart' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp campaigns' }))
    expect(screen.getByText('No campaigns match your filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'all' }))
    expect(screen.getByRole('link', { name: 'WA reminder' })).toBeInTheDocument()
  })

  it('pauses an active campaign through the toggle', async () => {
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Abandoned cart' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Pause' })[0])
    await waitFor(() => expect(screen.getAllByText('Paused').length).toBe(2))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(patch[0]).toBe('/api/admin/campaigns/abandoned_cart')
    expect(JSON.parse(patch[1].body)).toEqual({ enabled: false })
  })

  it('Run now confirms, posts and toasts the sent count', async () => {
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Abandoned cart' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Sent 7 email(s).', 'success'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Run campaign now?' }))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/campaigns/abandoned_cart/run' && c[1]?.method === 'POST')).toBe(true)
  })

  it('does not run when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false)
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Abandoned cart' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0])
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/run'))).toBe(false)
  })

  it('toasts the server error when a run fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => (init?.method ? json(false, { error: 'Already running' }) : json(true, { campaigns, total: 5 })))
    render(asAdmin(<CampaignsListClient />))
    await screen.findByRole('link', { name: 'Abandoned cart' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already running', 'error'))
  })

  it('drafts-only mode lists pending drafts and can publish or discard them', async () => {
    render(asAdmin(<CampaignsListClient draftsOnly />, ['campaigns:write']))
    expect(screen.getByText('drafts-skeleton')).toBeInTheDocument()
    expect(await screen.findByText('Pending Drafts (1)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Birthday published', 'success'))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/campaigns/birthday/publish')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/campaigns/birthday/draft' && c[1]?.method === 'DELETE')).toBe(true))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }))
  })

  it('drafts-only hides publish and discard without write access', async () => {
    render(asMember(<CampaignsListClient draftsOnly />, ['campaigns:read']))
    await screen.findByText('Pending Drafts (1)')
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  })
})
