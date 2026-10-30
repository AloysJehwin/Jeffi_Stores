import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

const push = vi.fn()
let canWrite = true
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams(window.location.search) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import GoogleAdsClient from '@admin/app/(admin)/admin/google-ads/GoogleAdsClient'

// Connecting lives in the gear dialog (top right), the same as every integration page.
const openGear = () => fireEvent.click(screen.getByRole('button', { name: /Google Ads connection \(/ }))

const env = {
  developerToken: true,
  oauthClient: true,
  managerId: null,
  managerRefreshToken: false,
  platformCustomerId: null,
  ready: true,
  missing: [],
}
const base = {
  env,
  oauth: { enabled: true, redirectUri: 'https://admin.jeffistores.in/api/admin/integrations/google/callback', missing: [] },
  flagship: false,
  serviceAccountEmail: null,
  connected: false,
  pendingAccount: false,
  connectedVia: null,
  customerId: null,
  loginCustomerId: null,
  accountName: null,
} as any

const fetchMock = vi.fn()
beforeEach(() => {
  canWrite = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('GoogleAdsClient', () => {
  it('shows the setup checklist when the developer token is missing', () => {
    render(<GoogleAdsClient initialStatus={{ ...base, env: { ...env, developerToken: false } }} currency="INR" hasData={false} />)
    openGear()
    expect(screen.getByText(/not configured on this platform/)).toBeTruthy()
    expect(screen.getByText(/integrations\/google\/callback/)).toBeTruthy()
  })

  it('offers sign-in and manual entry when not connected', () => {
    render(<GoogleAdsClient initialStatus={base} currency="INR" hasData={false} />)
    expect(screen.getByText(/Not connected/)).toBeTruthy()
    openGear()
    const link = screen.getByText('Connect with Google').closest('a')!
    expect(link.getAttribute('href')).toBe('/api/admin/integrations/google-ads/connect')
    expect(screen.getByText('Enter manually')).toBeTruthy()
    expect(screen.queryByText('Platform service account')).toBeNull()
  })

  it('hides connect actions from read-only admins', () => {
    canWrite = false
    render(<GoogleAdsClient initialStatus={base} currency="INR" hasData={false} />)
    openGear()
    expect(screen.queryByText('Connect with Google')).toBeNull()
    expect(screen.getByText(/An admin with Google Ads write access can connect it/)).toBeTruthy()
  })

  it('loads the overview for a connected account', async () => {
    // The Drafts tab label reads its count from /api/admin/draft-locks; everything else is the report.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/admin/draft-locks')
        ? new Response(JSON.stringify({ items: [], total: 0 }))
        : new Response(
        JSON.stringify({
          data: {
            account: null,
            range: { from: '2026-09-17', to: '2026-10-16' },
            previous: { from: '2026-08-18', to: '2026-09-16' },
            kpis: { cost: 1000, impressions: 5000, clicks: 100, conversions: 4, conversionsValue: 6000, ctr: 0.02, avgCpc: 10, roas: 6, costPerConversion: 250 },
            previousKpis: { cost: 500, impressions: 2500, clicks: 50, conversions: 2, conversionsValue: 2000, ctr: 0.02, avgCpc: 10, roas: 4, costPerConversion: 250 },
            trend: [],
            byNetwork: [],
            byDevice: [],
            policyIssues: 0,
            disapproved: 0,
            lastSync: null,
            orders: { available: true, orders: 3, revenue: 4500, refunds: 0, tax: 500, cogs: 2000 },
            returns: { netRevenue: 4500, grossProfit: 2000, trueRoas: 4.5, poas: 2, profitAfterAds: 1000 },
          },
        })
      )
    )
    render(
      <GoogleAdsClient
        initialStatus={{ ...base, connected: true, connectedVia: 'oauth', customerId: '1234567890', accountName: 'Acme' }}
        currency="INR"
        hasData
      />
    )
    expect(await screen.findByText('True ROAS')).toBeTruthy()
    expect(screen.getByText('4.50x')).toBeTruthy()
    const reportCall = fetchMock.mock.calls.map(c => String(c[0])).find(u => u.includes('/google-ads/report'))
    expect(reportCall).toMatch(/\/api\/admin\/google-ads\/report\?tab=overview&from=\d{4}-\d{2}-\d{2}&to=/)
    expect(screen.getByText(/Acme 123-456-7890/)).toBeTruthy()
  })

  it('never offers Disconnect for the platform service account', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: {} })))
    render(
      <GoogleAdsClient initialStatus={{ ...base, flagship: true, connected: true, connectedVia: 'platform', customerId: '1112223333' }} currency="INR" hasData />
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByLabelText('Disconnect')).toBeNull()
    expect(screen.getByLabelText('Sync now (last 30 days)')).toBeTruthy()
  })
})
