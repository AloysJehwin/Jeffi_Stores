import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/admin/campaigns/abandoned_cart/view' }))
vi.mock('@/hooks/useStoreFlags', () => ({ useMessagingChannels: () => ({ sms: true, whatsapp: false, push: false, email: true }) }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: () => <div>changelog</div> }))
vi.mock('@/components/admin/kit/draft-lock', () => ({ ViewDraftLink: ({ held }: any) => <a href={held.href}>View draft of {held.ownerName}</a> }))
vi.mock('@/components/admin/campaigns/WhatsAppTemplateEditor', () => ({ WhatsAppPreview: () => <div>wa-preview</div> }))
vi.mock('@/components/admin/campaigns/PushEditor', () => ({ PushPreview: () => <div>push-preview</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/[kind]/CampaignLoading', () => ({ CampaignViewLoading: () => <div>loading-campaign</div> }))
vi.mock('@admin/app/(admin)/admin/campaigns/[kind]/view/actions', () => ({ startCampaignDraft: vi.fn() }))
vi.mock('@admin/app/(admin)/admin/campaigns/_components/campaign-presentation', () => ({
  getChannels: () => ['email'],
  ChannelChip: ({ channel }: any) => <span>chip:{channel}</span>,
  CampaignStatsGrid: () => <div>stats-grid</div>,
  CampaignPushStats: () => <div>push-stats</div>,
}))
vi.mock('@admin/app/(admin)/admin/campaigns/[kind]/_components/CampaignOpsPanels', () => ({
  EligibleRecipientsPanel: () => <div>eligible-panel</div>,
  RecentSendsPanel: ({ initialSends, initialTotal }: any) => <div>recent-sends:{initialSends.length}/{initialTotal}</div>,
  WhatsAppLogPanel: () => <div>wa-log</div>,
  CampaignRecipientsDialog: () => null,
}))

import CampaignViewClient from '@admin/app/(admin)/admin/campaigns/[kind]/view/CampaignViewClient'

const campaign = {
  name: 'Abandoned cart',
  description: 'Nudge shoppers',
  enabled: true,
  delay_hours: 4,
  discount_percent: 10,
  subject_template: 'Hi {{firstName}}, you left something',
  body_template: '<p>Come back {{firstName}}</p>',
  template_layout: null,
  template_mode: 'rich',
  sms_template: 'Hey {{firstName}}, your cart awaits',
  last_run_at: null,
  parameters: { smsEnabled: true },
  updated_at: '2026-03-01',
}
const fetchMock = vi.fn()
const ok = (body: unknown) => ({ ok: true, json: async () => body })

describe('CampaignViewClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok({ campaign, recentSends: [{ id: 1 }, { id: 2 }], total: 9, whatsappLogs: [] }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows loading, then the campaign summary, panels and previews', async () => {
    render(asAdmin(<CampaignViewClient kind="abandoned_cart" />, ['campaigns:write']))
    expect(screen.getByText('loading-campaign')).toBeInTheDocument()
    expect(await screen.findByText('Abandoned cart')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaigns/abandoned_cart', { credentials: 'include' })
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Nudge shoppers')).toBeInTheDocument()
    expect(screen.getByText('4h after trigger')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('never')).toBeInTheDocument()
    expect(screen.getByText('stats-grid')).toBeInTheDocument()
    expect(screen.getByText('recent-sends:2/9')).toBeInTheDocument()
    expect(screen.getByText('chip:email')).toBeInTheDocument()
    // Variables are substituted in the subject preview and the SMS preview.
    expect(screen.getByText('Hi Sample, you left something')).toBeInTheDocument()
    expect(screen.getByText('Hey Sample, your cart awaits')).toBeInTheDocument()
    expect(screen.getByTitle('Email preview')).toBeInTheDocument()
    expect(screen.queryByText('wa-preview')).not.toBeInTheDocument()
  })

  it('shows Paused and the block-builder mode label', async () => {
    fetchMock.mockResolvedValue(ok({ campaign: { ...campaign, enabled: false, template_mode: 'blocks', blocks: [] } }))
    render(asAdmin(<CampaignViewClient kind="abandoned_cart" />))
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('Block builder')).toBeInTheDocument()
  })

  it('offers Edit with write access, Edit Draft when a draft exists, and nothing without write', async () => {
    const { unmount } = render(asAdmin(<CampaignViewClient kind="abandoned_cart" />, ['campaigns:write']))
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue(ok({ campaign: { ...campaign, draft_fields: { name: 'x' } } }))
    const second = render(asAdmin(<CampaignViewClient kind="abandoned_cart" />))
    expect(await screen.findByRole('link', { name: /Edit Draft/ })).toHaveAttribute('href', expect.stringContaining('/admin/campaigns/abandoned_cart/edit'))
    expect(screen.getByText('Draft pending')).toBeInTheDocument()
    second.unmount()
    render(asMember(<CampaignViewClient kind="abandoned_cart" />, ['campaigns:read']))
    await screen.findByText('Abandoned cart')
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('links to the held draft instead of editing when another admin holds it', async () => {
    render(asAdmin(<CampaignViewClient kind="abandoned_cart" heldDraft={{ ownerName: 'Asha', href: '/d/1' }} />, ['campaigns:write']))
    expect(await screen.findByRole('link', { name: 'View draft of Asha' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })

  it('shows the API error message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Campaign not found' }) })
    render(asAdmin(<CampaignViewClient kind="nope" />))
    expect(await screen.findByText('Campaign not found')).toBeInTheDocument()
  })

  it('falls back to a generic message on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('net down'))
    render(asAdmin(<CampaignViewClient kind="abandoned_cart" />))
    await waitFor(() => expect(screen.getByText('net down')).toBeInTheDocument())
  })

  it('loads the SMS body from the linked library template', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('messaging-templates/sms/promo-1')
        ? ok({ current_version: { body: 'Library SMS for {{firstName}}' } })
        : ok({ campaign: { ...campaign, sms_template: '', sms_template_slug: 'promo-1' } })
    )
    render(asAdmin(<CampaignViewClient kind="abandoned_cart" />))
    expect(await screen.findByText('Library SMS for Sample')).toBeInTheDocument()
  })
})
