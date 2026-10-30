import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite, useCanUseAi: () => false }))
vi.mock('@controller/app/(admin)/admin/google-ads/_components/ManageContext', () => ({ useAdsManage: () => null }))

import AudiencesView from '@controller/app/(admin)/admin/google-ads/_components/AudiencesView'
import AlertsPanel from '@controller/app/(admin)/admin/google-ads/_components/AlertsPanel'
import { DEFAULT_ALERT_CONFIG } from '@/lib/google-ads/alerts'

const audience = (over: Record<string, unknown> = {}) => ({
  segment: 'repeat_buyers',
  label: 'Repeat buyers',
  description: 'Customers with 2 or more paid orders',
  use: 'Audience signal',
  enabled: true,
  params: { minOrders: 2, days: 180, topPercent: 10 },
  userList: 'customers/1/userLists/5',
  listId: '5',
  inSegment: 120,
  members: 80,
  added: 3,
  removed: 1,
  sizeForSearch: 0,
  sizeForDisplay: 0,
  matchRate: null,
  matchRateRange: 'MATCH_RATE_RANGE_41_TO_50',
  eligibleForSearch: true,
  eligibleForDisplay: true,
  membershipStatus: 'OPEN',
  lastRefreshAt: '2026-10-16T00:30:00Z',
  lastRefreshStatus: 'success',
  lastError: null,
  googleCheckedAt: null,
  available: true,
  ...over,
})
const data = (over: Record<string, unknown> = {}) => ({ audiences: [audience()], termsAcceptedAt: '2026-10-01', minActiveMembers: 100, membershipDays: 540, campaigns: [], ...over }) as any

const fetchMock = vi.fn()
beforeEach(() => {
  canWrite = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AudiencesView', () => {
  it('shows counts, match rate, the consent basis and the minimum size', () => {
    render(<AudiencesView d={data()} />)
    expect(screen.getByText('Repeat buyers')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect(screen.getByText('41-50')).toBeTruthy()
    expect(screen.getByText(/latest order's choice is used/)).toBeTruthy()
    expect(screen.getByText(/at least 100 active matched members/)).toBeTruthy()
    expect(screen.getByText(/Below Google's 100-member minimum/)).toBeTruthy()
  })

  it('asks for the Customer Match terms before anything is uploaded', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: data() })))
    render(<AudiencesView d={data({ termsAcceptedAt: null })} />)
    expect(screen.queryByLabelText('Refresh lists now')).toBeNull()
    const accept = screen.getByText('Accept') as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept/ }))
    fireEvent.click(accept)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ op: 'terms', accept: true })
  })
})

describe('AlertsPanel', () => {
  it('lists open alerts and lets a writer dismiss one', async () => {
    const payload = {
      alerts: [{ id: '3', rule: 'tracking_stopped', dedupe_key: 'tracking_stopped', severity: 'critical', title: 'No orders from Google Ads clicks in 3 days', message: 'Check the tag', status: 'open', first_seen_at: '2026-10-16T00:00:00Z' }],
      config: DEFAULT_ALERT_CONFIG,
      notify: { emails: true, digest: true },
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload)))
    render(<AlertsPanel />)
    expect(await screen.findByText('No orders from Google Ads clicks in 3 days')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss alert'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ op: 'dismiss', id: '3' })
  })

  it('is read-only without write access', async () => {
    canWrite = false
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ alerts: [], config: DEFAULT_ALERT_CONFIG, notify: { emails: true, digest: true } })))
    render(<AlertsPanel />)
    expect(await screen.findByText(/No open alerts/)).toBeTruthy()
    expect(screen.queryByLabelText('Alert settings')).toBeNull()
  })
})
