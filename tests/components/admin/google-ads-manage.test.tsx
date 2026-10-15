import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

let canWrite = true
let canAi = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  useCanUseAi: () => canAi,
  useHasScope: () => canWrite,
}))

import { ConfirmProvider } from '@/contexts/ConfirmContext'
import { AdsManageProvider } from '@/app/(admin)/admin/google-ads/_components/ManageContext'
import { NewCampaignButton } from '@/app/(admin)/admin/google-ads/_components/CampaignWizard'
import { CampaignRowActions, SearchTermRowActions } from '@/app/(admin)/admin/google-ads/_components/ManageActions'
import { CampaignsView } from '@/app/(admin)/admin/google-ads/_components/ReportViews'

const BOOTSTRAP = {
  store: { name: 'Acme Tools', baseUrl: 'https://acme.in', logoUrl: null, currency: 'INR' },
  budget: { revenue30d: 78451, orders30d: 8, dailyRevenue: 2615, suggestedDaily: 250 },
  shipTo: { states: [], allIndia: true },
  categories: [{ id: 'c1', name: 'Drills', slug: 'drills', parentId: null, products: 12 }],
  brands: [{ name: 'Bosch', products: 9 }],
  labels: { margin: { 'margin-high': 3 }, velocity: { bestseller: 1 }, stock: { 'in-stock': 5 } },
  images: [],
  merchantConnected: true,
  facts: ['Free delivery over ₹999'],
}

const fetchMock = vi.fn()
const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const posts = () =>
  fetchMock.mock.calls.filter(c => c[1]?.method === 'POST').map(c => ({ url: String(c[0]), body: JSON.parse(c[1].body) }))

beforeEach(() => {
  canWrite = true
  canAi = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const wrap = (ui: React.ReactNode, onChanged = vi.fn()) =>
  render(
    <ConfirmProvider>
      <AdsManageProvider currency="INR" onChanged={onChanged}>
        {ui}
      </AdsManageProvider>
    </ConfirmProvider>
  )

describe('New campaign wizard', () => {
  it('is hidden without campaign management', () => {
    canWrite = false
    render(<NewCampaignButton onCreated={vi.fn()} />)
    expect(screen.queryByLabelText('New campaign')).toBeNull()
  })

  it('walks a Search campaign through checks, a Google preview and creation', async () => {
    const onCreated = vi.fn()
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/google-ads/manage' && !init?.method) return ok(BOOTSTRAP)
      if (url === '/api/admin/google-ads/manage/campaigns') {
        const body = JSON.parse(String(init!.body))
        return body.preview
          ? ok({ ok: true, preview: true, operations: { campaignBudgetOperation: 1, campaignOperation: 1, adGroupOperation: 1 }, followUps: [] })
          : ok({ ok: true, campaignId: '901', resourceNames: [], steps: [], refreshError: null })
      }
      return ok({})
    })
    render(<NewCampaignButton onCreated={onCreated} />)
    fireEvent.click(screen.getByLabelText('New campaign'))

    // Budget suggested from the last 30 days of revenue.
    expect(await screen.findByText(/Suggested: ₹250\/day, about 10% of daily revenue/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('e.g. Power tools - Search'), { target: { value: 'Drills - Search' } })

    fireEvent.click(screen.getByText(/3\. Ads & keywords/))
    fireEvent.change(screen.getByPlaceholderText('e.g. Cordless drills'), { target: { value: 'Cordless drills' } })
    fireEvent.change(screen.getByLabelText('Keywords to add'), { target: { value: 'cordless drill\n[drill machine]' } })
    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByText('cordless drill · Phrase')).toBeTruthy()
    expect(screen.getByText('drill machine · Exact')).toBeTruthy()

    // Client-side length check with a live counter.
    fireEvent.change(screen.getByLabelText('Headline 1'), { target: { value: 'x'.repeat(31) } })
    expect(screen.getByLabelText('Headline 1').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('31/30')).toBeTruthy()

    fireEvent.click(screen.getByText(/5\. Review/))
    expect(screen.getByText('Fix these first:')).toBeTruthy()
    expect(screen.getByText('Ad group "Cordless drills" headline 1 is longer than 30 characters')).toBeTruthy()
    expect((screen.getByText('Create campaign') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText(/3\. Ads & keywords/))
    fireEvent.change(screen.getByLabelText('Headline 1'), { target: { value: 'Cordless Drills' } })
    fireEvent.change(screen.getByLabelText('Headline 2'), { target: { value: 'Top Brands In Stock' } })
    fireEvent.change(screen.getByLabelText('Headline 3'), { target: { value: 'Shop Drills Online' } })
    fireEvent.change(screen.getByLabelText('Description 1'), { target: { value: 'Bosch and Makita drills, delivered fast.' } })
    fireEvent.change(screen.getByLabelText('Description 2'), { target: { value: 'Free delivery over ₹999. Cash on delivery.' } })

    fireEvent.click(screen.getByText(/5\. Review/))
    expect(screen.queryByText('Fix these first:')).toBeNull()
    fireEvent.click(screen.getByText('Check with Google'))
    expect(await screen.findByText(/Google accepted the campaign \(3 changes checked, nothing created yet\)/)).toBeTruthy()

    fireEvent.click(screen.getByText('Create campaign'))
    expect(await screen.findByText(/Created campaign 901 \(paused\)/)).toBeTruthy()
    expect(onCreated).toHaveBeenCalled()

    const [preview, create] = posts().filter(p => p.url.endsWith('/manage/campaigns'))
    expect(preview.body.preview).toBe(true)
    expect(create.body.preview).toBe(false)
    expect(create.body.spec).toMatchObject({
      type: 'SEARCH',
      name: 'Drills - Search',
      dailyBudget: 250,
      status: 'PAUSED',
      locations: [{ id: 'geoTargetConstants/2356', name: 'India' }],
      languages: ['languageConstants/1000'],
    })
    expect(create.body.spec.adGroups[0]).toMatchObject({
      name: 'Cordless drills',
      keywords: [
        { text: 'cordless drill', matchType: 'PHRASE' },
        { text: 'drill machine', matchType: 'EXACT' },
      ],
      ad: { headlines: ['Cordless Drills', 'Top Brands In Stock', 'Shop Drills Online'], finalUrl: 'https://acme.in' },
    })
  })

  it('offers Write with AI only when the plan includes AI', async () => {
    fetchMock.mockImplementation((url: string) => (url === '/api/admin/google-ads/manage' ? ok(BOOTSTRAP) : ok({})))
    canAi = false
    render(<NewCampaignButton onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('New campaign'))
    await screen.findByText(/Suggested: ₹250/)
    fireEvent.click(screen.getByText(/3\. Ads & keywords/))
    expect(screen.queryByText('Write with AI')).toBeNull()
  })

  it('fills headlines and descriptions from AI', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/admin/google-ads/manage') return ok(BOOTSTRAP)
      if (url === '/api/admin/google-ads/manage/ai-copy')
        return ok({ kind: 'rsa', headlines: ['Cordless Drills', 'Top Brands', 'Fast Delivery'], descriptions: ['One.', 'Two.'], dropped: 2 })
      return ok({})
    })
    render(<NewCampaignButton onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('New campaign'))
    await screen.findByText(/Suggested: ₹250/)
    fireEvent.click(screen.getByText(/3\. Ads & keywords/))
    fireEvent.click(screen.getByText('Write with AI'))
    await waitFor(() => expect((screen.getByLabelText('Headline 2') as HTMLInputElement).value).toBe('Top Brands'))
    expect(screen.getByText(/2 AI line\(s\) were too long or repeated/)).toBeTruthy()
    expect(posts().find(p => p.url.endsWith('/ai-copy'))!.body).toMatchObject({ kind: 'rsa', context: { facts: ['Free delivery over ₹999'] } })
  })
})

const CAMPAIGN = { campaignId: '55', name: 'Drills', status: 'ENABLED', budget: 500, biddingStrategy: 'MAXIMIZE_CONVERSIONS', channelType: 'SEARCH' }

describe('row actions', () => {
  it('are hidden without campaign management', () => {
    canWrite = false
    wrap(<CampaignRowActions row={CAMPAIGN} />)
    expect(screen.queryByLabelText('Pause campaign')).toBeNull()
  })

  it('pause a campaign and show the result', async () => {
    const onChanged = vi.fn()
    fetchMock.mockImplementation(() => ok({ ok: true, summary: 'Paused campaign "Drills"', refreshError: null }))
    wrap(<CampaignRowActions row={CAMPAIGN} />, onChanged)
    fireEvent.click(screen.getByLabelText('Pause campaign'))
    expect(await screen.findByText('Paused campaign "Drills".')).toBeTruthy()
    expect(posts()[0]).toEqual({ url: '/api/admin/google-ads/manage', body: { action: 'campaign.status', campaignId: '55', status: 'PAUSED' } })
    expect(onChanged).toHaveBeenCalled()
  })

  it('confirm before removing, and send nothing when cancelled', async () => {
    fetchMock.mockImplementation(() => ok({ ok: true, summary: 'Removed campaign "Drills"' }))
    wrap(<CampaignRowActions row={CAMPAIGN} />)
    fireEvent.click(screen.getByLabelText('Remove campaign'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/cannot be enabled again/)).toBeTruthy()
    fireEvent.click(within(dialog).getByText('Cancel'))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Remove campaign'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Remove'))
    await waitFor(() => expect(posts()[0]?.body).toEqual({ action: 'campaign.remove', campaignId: '55' }))
  })

  it('change the budget through a prompt', async () => {
    fetchMock.mockImplementation(() => ok({ ok: true, summary: 'Changed the daily budget' }))
    wrap(<CampaignRowActions row={CAMPAIGN} />)
    fireEvent.click(screen.getByLabelText('Change budget'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByDisplayValue('500'), { target: { value: '₹750' } })
    fireEvent.click(within(dialog).getByText('Change budget'))
    await waitFor(() => expect(posts()[0]?.body).toEqual({ action: 'campaign.budget', campaignId: '55', dailyBudget: 750 }))
  })

  it('show Google errors as a notice', async () => {
    fetchMock.mockImplementation(() => ok({ error: 'Budget: Too low.', problems: [{ message: 'Too low.' }, { where: 'Budget', message: 'Below the minimum' }] }, 400))
    wrap(<CampaignRowActions row={CAMPAIGN} />)
    fireEvent.click(screen.getByLabelText('Pause campaign'))
    expect(await screen.findByText('Budget: Too low. · Budget: Below the minimum')).toBeTruthy()
  })

  it('add a search term as a negative keyword after confirming', async () => {
    fetchMock.mockImplementation(() => ok({ ok: true, summary: 'Added negative keyword' }))
    wrap(<SearchTermRowActions row={{ term: 'drill repair', campaignId: '55', adGroupId: '7', campaignChannel: 'SHOPPING' }} />)
    expect(screen.queryByLabelText('Add as exact keyword')).toBeNull()
    fireEvent.click(screen.getByLabelText('Add as negative keyword'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Add negative'))
    await waitFor(() =>
      expect(posts()[0]?.body).toEqual({ action: 'negative.add', level: 'campaign', campaignId: '55', text: 'drill repair', matchType: 'EXACT' })
    )
  })

  it('add an actions column to the campaigns table only for managers', () => {
    wrap(<CampaignsView rows={[{ ...CAMPAIGN, budgetPeriod: 'DAILY', cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0, ctr: null, avgCpc: null, roas: null }]} currency="INR" />)
    expect(screen.getByLabelText('Change bid target')).toBeTruthy()
    cleanup()
    canWrite = false
    wrap(<CampaignsView rows={[{ ...CAMPAIGN, budgetPeriod: 'DAILY', cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0, ctr: null, avgCpc: null, roas: null }]} currency="INR" />)
    expect(screen.queryByLabelText('Change bid target')).toBeNull()
  })
})
