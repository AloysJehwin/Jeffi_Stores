import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }))
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import ConversionsView from '@/app/(admin)/admin/google-ads/_components/ConversionsView'
import GoogleAdsClient from '@/app/(admin)/admin/google-ads/GoogleAdsClient'
import type { ConversionsSummary, DataManagerRequest, GoogleConversionsData, UploadLog } from '@/lib/google-ads/conversions/types'

const ACTION = 'customers/1234567890/conversionActions/777'

const summary = (o: Partial<ConversionsSummary> = {}): ConversionsSummary => ({
  available: true,
  range: { from: '2026-09-17', to: '2026-10-16' },
  config: {
    action: null,
    actionName: null,
    owner: null,
    account: null,
    setAt: null,
    connectedCustomer: '1234567890',
    matchesAccount: false,
    lastRunAt: null,
    lastRun: null,
    uploadApi: 'data_manager',
  },
  counts: { pending: 2, uploaded: 5, failed: 1, skipped: 1 },
  uploadedValue: 5900,
  byKind: [],
  backlog: { pending: 2, failed: 1 },
  browserConversion: true,
  auth: { connectedVia: 'oauth', dataManager: 'granted' },
  ...o,
})

const configured = summary({
  config: {
    action: ACTION,
    actionName: 'Purchase (server)',
    owner: '1234567890',
    account: '1234567890',
    setAt: '2026-10-01T00:00:00Z',
    connectedCustomer: '1234567890',
    matchesAccount: true,
    lastRunAt: '2026-10-16T05:30:00Z',
    lastRun: {
      status: 'error',
      uploaded: 0,
      failed: 0,
      retrying: 2,
      skipped: 0,
      enqueued: 0,
      error: 'Google refused the upload: ... Data Manager API (CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE).',
      errorCode: 'CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE',
      identifiers: true,
      finishedAt: '2026-10-16T05:30:00Z',
    },
    uploadApi: 'data_manager',
  },
})

const google = (o: Partial<GoogleConversionsData> = {}): GoogleConversionsData => ({
  actions: [
    { resourceName: ACTION, id: '777', name: 'Purchase (server)', type: 'UPLOAD_CLICKS', status: 'ENABLED', category: 'PURCHASE', primaryForGoal: false, countingType: 'MANY_PER_CLICK', owner: '1234567890', origin: null, lookbackDays: 90, defaultCurrency: 'INR', alwaysUseDefaultValue: false },
    { resourceName: 'customers/1234567890/conversionActions/1', id: '1', name: 'Website purchase', type: 'WEBPAGE', status: 'ENABLED', category: 'PURCHASE', primaryForGoal: true, countingType: 'ONE_PER_CLICK', owner: '1234567890', origin: null, lookbackDays: 30, defaultCurrency: 'INR', alwaysUseDefaultValue: false },
  ],
  settings: { conversionCustomer: '1234567890', trackingStatus: 'CONVERSION_TRACKING_MANAGED_BY_SELF', acceptedCustomerDataTerms: true, enhancedConversions: 'ON' },
  diagnostics: [
    {
      scope: 'account',
      client: 'GOOGLE_ADS_API',
      actionName: null,
      status: 'NEEDS_ATTENTION',
      total: 2,
      successful: 1,
      pending: 0,
      successRate: 0.5,
      lastUpload: '2026-10-15 11:00:00',
      alerts: [{ error: 'CLICK_NOT_FOUND', percent: 0.5 }],
      daily: [{ key: '2026-10-15', successful: 1, failed: 1, pending: 0 }],
      jobs: [],
    },
  ],
  errors: [],
  ...o,
})

const log: UploadLog = {
  rows: [
    {
      id: 5,
      order_id: 'o5',
      order_number: 'ORD-5',
      kind: 'purchase',
      version: 0,
      value: 1180,
      currency_code: 'INR',
      status: 'failed',
      attempts: 8,
      next_attempt_at: null,
      error_code: 'NO_CONVERSION_ACTION_FOUND',
      error: 'The conversion action is missing or not enabled in this account. Pick another one. (NO_CONVERSION_ACTION_FOUND)',
      uploaded_at: null,
      created_at: '2026-10-15T09:00:00Z',
      conversion_at: '2026-10-15T09:00:00Z',
      click: 'gclid',
      ads_consent: true,
      request_id: null,
      request_status: null,
      request_errors: null,
      request_events: null,
    },
    {
      id: 6,
      order_id: 'o6',
      order_number: 'ORD-6',
      kind: 'restatement',
      version: 2,
      value: 900,
      currency_code: 'INR',
      status: 'uploaded',
      attempts: 1,
      next_attempt_at: null,
      error_code: null,
      error: null,
      uploaded_at: '2026-10-16T05:00:00Z',
      created_at: '2026-10-15T10:00:00Z',
      conversion_at: '2026-10-14T09:00:00Z',
      click: 'gbraid',
      ads_consent: null,
      request_id: 'req-6',
      request_status: 'PARTIAL_SUCCESS',
      request_errors: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', count: 1 }],
      request_events: 3,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
}

const requests: DataManagerRequest[] = [
  {
    requestId: 'req-6',
    kind: 'purchase',
    events: 3,
    status: 'PARTIAL_SUCCESS',
    recordCount: 3,
    errors: [{ reason: 'PROCESSING_ERROR_REASON_CLICK_NOT_FOUND', count: 1 }],
    warnings: [],
    fieldWarnings: [],
    checks: 2,
    createdAt: '2026-10-16T05:00:00Z',
    lastCheckedAt: '2026-10-16T05:40:00Z',
    finishedAt: '2026-10-16T05:40:00Z',
    error: null,
  },
  {
    requestId: 'req-7',
    kind: 'adjustment',
    events: 1,
    status: 'PROCESSING',
    recordCount: null,
    errors: [],
    warnings: [],
    fieldWarnings: [],
    checks: 1,
    createdAt: '2026-10-16T05:30:00Z',
    lastCheckedAt: null,
    finishedAt: null,
    error: null,
  },
]

const fetchMock = vi.fn()
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function routeFetch(overrides: Record<string, unknown> = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    for (const [key, body] of Object.entries(overrides)) if (u.includes(key)) return json(body)
    if (u.includes('/conversions/google')) return json(google())
    if (u.includes('/conversions/action')) return json({ ok: true, created: true, action: { name: 'Purchase (server)' } })
    if (u.includes('/conversions/upload')) return json({ status: 'success', uploaded: 2, retrying: 0, failed: 0, skipped: 1 })
    if (u.includes('/conversions/retry')) return json({ retried: 1 })
    if (u.includes('/conversions/requests')) return json({ requests })
    if (u.includes('/conversions/settings')) return json({ ok: true })
    if (u.includes('/conversions/check')) return json({ ok: true, code: null, message: 'Google accepted the setup.', warnings: [] })
    if (u.includes('/api/admin/google-ads/conversions')) return json(log)
    if (u.includes('/report')) return json({ data: summary() })
    return json({ error: `unexpected ${method} ${u}` }, 500)
  })
}

const calls = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part))

beforeEach(() => {
  canWrite = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  routeFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('ConversionsView', () => {
  it('offers to create the server action, secondary by default when the tag already sends purchases', async () => {
    render(<ConversionsView d={summary()} currency="INR" />)
    expect(screen.getByText(/No conversion action yet/)).toBeTruthy()
    expect(screen.getByText('Count each purchase once')).toBeTruthy()
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(await screen.findByText(/Enhanced conversions are on/)).toBeTruthy()
    expect(screen.getByText('Website purchase')).toBeTruthy()
    expect(screen.getByText(/1 of 2 accepted \(50\.0%\)/)).toBeTruthy()
    expect(screen.getByText(/Click not found: 50\.0% of uploads/)).toBeTruthy()
    expect(await screen.findByText('ORD-5')).toBeTruthy()
    expect(screen.getByText('Restatement #2')).toBeTruthy()

    fireEvent.click(screen.getByText('Create "Purchase (server)"'))
    await waitFor(() => expect(calls('/conversions/action')).toHaveLength(1))
    const [, init] = calls('/conversions/action')[0]
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'create', primary: false })
    expect(await screen.findByText(/Created "Purchase \(server\)"/)).toBeTruthy()
  })

  it('defaults to primary when no tag conversion is set, and can upload to an existing import action', async () => {
    render(<ConversionsView d={summary({ browserConversion: false })} currency="INR" />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(await screen.findByText('Upload here'))
    await waitFor(() => expect(calls('/conversions/action')).toHaveLength(1))
    expect(JSON.parse(String(calls('/conversions/action')[0][1].body))).toEqual({ mode: 'select', resourceName: ACTION })
  })

  it('shows where purchases go, the last run error, and runs and retries uploads', async () => {
    render(<ConversionsView d={configured} currency="INR" />)
    expect(screen.getByText(/Uploading to/)).toBeTruthy()
    expect(screen.getByText(/CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE/)).toBeTruthy()
    expect(await screen.findByText('Uploading here')).toBeTruthy()
    expect(screen.queryByText(/Create "Purchase/)).toBeNull()

    fireEvent.click(screen.getByLabelText('Upload now'))
    expect(await screen.findByText('Uploaded 2, retrying 0, failed 0, skipped 1.')).toBeTruthy()

    await screen.findByText('ORD-5')
    fireEvent.click(screen.getByLabelText('Retry'))
    await waitFor(() => expect(calls('/conversions/retry')).toHaveLength(1))
    expect(JSON.parse(String(calls('/conversions/retry')[0][1].body))).toEqual({ ids: [5] })
    fireEvent.click(screen.getByLabelText('Retry all failed'))
    await waitFor(() => expect(calls('/conversions/retry')).toHaveLength(2))
  })

  it('filters the upload log by status', async () => {
    render(<ConversionsView d={configured} currency="INR" />)
    await screen.findByText('ORD-5')
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    await waitFor(() => expect(calls('/api/admin/google-ads/conversions?').some(([u]) => String(u).includes('status=failed'))).toBe(true))
  })

  it('warns when two purchase actions are primary', async () => {
    const actions = google().actions.map(a => ({ ...a, primaryForGoal: true }))
    routeFetch({ '/conversions/google': google({ actions }) })
    render(<ConversionsView d={configured} currency="INR" />)
    expect(await screen.findByText(/2 purchase actions are primary/)).toBeTruthy()
  })

  it('is read-only without google_ads:write', async () => {
    canWrite = false
    render(<ConversionsView d={configured} currency="INR" />)
    await screen.findByText('ORD-5')
    expect(screen.queryByLabelText('Upload now')).toBeNull()
    expect(screen.queryByLabelText('Retry')).toBeNull()
    expect(screen.queryByText('Upload here')).toBeNull()
  })

  it('asks a Google sign-in without the Data Manager scope to reconnect, keeping the account', async () => {
    const missing = { ...configured, auth: { connectedVia: 'oauth' as const, dataManager: 'missing' as const } }
    render(<ConversionsView d={missing} currency="INR" />)
    expect(screen.getByText('Reconnect to enable conversion uploads')).toBeTruthy()
    expect((screen.getByText('Reconnect Google Ads') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/api/admin/integrations/google-ads/connect?reconnect=1'
    )
    cleanup()
    canWrite = false
    render(<ConversionsView d={missing} currency="INR" />)
    expect(screen.queryByText('Reconnect Google Ads')).toBeNull()
    expect(screen.getByText(/An admin with Google Ads write access can reconnect/)).toBeTruthy()
  })

  it("explains the platform's own credentials instead of a reconnect", () => {
    render(<ConversionsView d={{ ...configured, auth: { connectedVia: 'manager', dataManager: 'missing' } }} currency="INR" />)
    expect(screen.getByText('Conversion uploads are not allowed yet')).toBeTruthy()
    expect(screen.getByText(/manager connection does not allow Data Manager uploads/)).toBeTruthy()
    expect(screen.queryByText('Reconnect Google Ads')).toBeNull()
    cleanup()
    render(<ConversionsView d={{ ...configured, auth: { connectedVia: 'platform', dataManager: 'missing' } }} currency="INR" />)
    expect(screen.getByText(/Service Usage Consumer/)).toBeTruthy()
    cleanup()
    render(<ConversionsView d={{ ...configured, auth: { connectedVia: 'oauth', dataManager: 'granted' } }} currency="INR" />)
    expect(screen.queryByText(/Reconnect to enable/)).toBeNull()
  })

  it('switches the upload API and checks the setup without sending data', async () => {
    routeFetch({ '/report': { data: configured } })
    render(<ConversionsView d={configured} currency="INR" />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(r => r.checked)).toEqual([true, false])
    fireEvent.click(screen.getByLabelText('Google Ads API'))
    await waitFor(() => expect(calls('/conversions/settings')).toHaveLength(1))
    expect(JSON.parse(String(calls('/conversions/settings')[0][1].body))).toEqual({ uploadApi: 'ads_api' })
    expect(await screen.findByText('Conversions now upload through the Google Ads API.')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Check setup'))
    await waitFor(() => expect(calls('/conversions/check')).toHaveLength(1))
    expect(await screen.findByText('Google accepted the setup.')).toBeTruthy()
  })

  it('warns about the Google Ads API restriction and hides the setup check when it is chosen', () => {
    render(<ConversionsView d={{ ...configured, config: { ...configured.config, uploadApi: 'ads_api' } }} currency="INR" />)
    expect(screen.getByText(/Since 15 June 2026 Google only accepts/)).toBeTruthy()
    expect(screen.queryByLabelText('Check setup')).toBeNull()
    expect(screen.getByText(/Cancellations and full refunds are retracted/)).toBeTruthy()
  })

  it("lists Data Manager uploads with Google's verdict, also on the logged rows", async () => {
    render(<ConversionsView d={configured} currency="INR" />)
    expect(await screen.findByText('req-7')).toBeTruthy()
    expect(screen.getByText('Partly rejected')).toBeTruthy()
    expect(screen.getByText('Processing')).toBeTruthy()
    expect(screen.getByText('Rejected: Click not found x1')).toBeTruthy()
    expect(await screen.findByText(/Google rejected 1 of 3 events in this upload/)).toBeTruthy()
    expect(screen.getByText(/the Data Manager API cannot remove a conversion/)).toBeTruthy()
  })

  it('explains a store whose database has no queue yet', () => {
    render(<ConversionsView d={summary({ available: false })} currency="INR" />)
    expect(screen.getByText(/need a database update/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GoogleAdsClient', () => {
  it('has a Conversions tab backed by the report summary', async () => {
    window.history.replaceState({}, '', '/admin/google-ads?tab=conversions')
    routeFetch({ '/report': { data: configured } })
    render(
      <GoogleAdsClient
        initialStatus={
          {
            env: { developerToken: true, oauthClient: true, managerId: null, managerRefreshToken: false, platformCustomerId: null, ready: true, missing: [] },
            oauth: { enabled: true, redirectUri: '', missing: [] },
            flagship: false,
            serviceAccountEmail: null,
            connected: true,
            pendingAccount: false,
            connectedVia: 'oauth',
            customerId: '1234567890',
            loginCustomerId: null,
            accountName: 'Acme',
          } as any
        }
        currency="INR"
        hasData
      />
    )
    expect(screen.getByRole('button', { name: 'Conversions' })).toBeTruthy()
    expect(await screen.findByText(/Uploading to/)).toBeTruthy()
    expect(String(calls('/report')[0][0])).toMatch(/tab=conversions/)
  })
})
