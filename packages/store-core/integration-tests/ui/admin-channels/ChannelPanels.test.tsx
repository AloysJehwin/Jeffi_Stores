import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))

import { ChannelAlerts, ChangeHistory, JobRuns } from '@/components/admin/channels/ChannelPanels'

const ok = (data: unknown) => ({ ok: true, json: async () => data })
const alertsPayload = (over: Record<string, unknown> = {}) => ({
  alerts: [
    { id: 'a1', status: 'open', severity: 'critical', title: 'Feed rejected', message: '12 items disapproved', first_seen_at: '2026-03-01T10:00:00Z' },
    { id: 'a2', status: 'dismissed', severity: 'info', title: 'Old', message: null, first_seen_at: '2026-02-01T10:00:00Z' },
  ],
  config: { stale: { enabled: true, hours: 24 } },
  labels: { stale: 'Stale feed' },
  emails: false,
  ...over,
})

describe('ChannelAlerts', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    canWrite = true
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists open alerts with a count in the title', async () => {
    fetchMock.mockResolvedValue(ok(alertsPayload()))
    render(<ChannelAlerts channel="amazon" />)
    expect(await screen.findByText('Feed rejected')).toBeInTheDocument()
    expect(screen.getByText('Alerts (1)')).toBeInTheDocument()
    expect(screen.getByText('12 items disapproved')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/channels/amazon/alerts')
  })

  it('shows the empty message mentioning dismissed alerts', async () => {
    fetchMock.mockResolvedValue(ok(alertsPayload({ alerts: [{ id: 'a2', status: 'dismissed', severity: 'info', title: 'Old', first_seen_at: '2026-02-01T10:00:00Z' }] })))
    render(<ChannelAlerts channel="amazon" />)
    expect(await screen.findByText(/No open alerts; 1 dismissed alert\(s\)/)).toBeInTheDocument()
  })

  it('dismisses an alert and reloads', async () => {
    fetchMock.mockResolvedValue(ok(alertsPayload()))
    render(<ChannelAlerts channel="amazon" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss alert' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'DELETE' && c[0].endsWith('/alerts/a1'))).toBe(true))
  })

  it('hides write controls without permission', async () => {
    canWrite = false
    fetchMock.mockResolvedValue(ok(alertsPayload()))
    render(<ChannelAlerts channel="amazon" />)
    await screen.findByText('Feed rejected')
    expect(screen.queryByRole('button', { name: 'Dismiss alert' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alert settings' })).not.toBeInTheDocument()
  })

  it('edits alert settings and saves them', async () => {
    fetchMock.mockResolvedValue(ok(alertsPayload()))
    render(<ChannelAlerts channel="amazon" params={{ hours: 'Hours stale' }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Alert settings' }))
    expect(screen.getByText('Stale feed')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '48' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ config: { stale: { enabled: true, hours: 48 } }, emails: false })
  })

  it('shows a load error', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Forbidden' }) })
    render(<ChannelAlerts channel="amazon" />)
    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })
})

describe('ChangeHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>())
  })

  it('shows changes with who and result, and the empty state', async () => {
    const fetchMock = vi.fn<(...a: any[]) => any>().mockResolvedValue(ok({ changes: [{ id: 'c1', created_at: '2026-03-01T10:00:00Z', admin_email: 'a@x.com', summary: 'Pushed 3 prices', status: 'applied', error: null }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(<ChangeHistory channel="gmc" />)
    expect(await screen.findByText('Pushed 3 prices')).toBeInTheDocument()
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByText('applied')).toBeInTheDocument()
    unmount()
    fetchMock.mockResolvedValue(ok({ changes: [] }))
    render(<ChangeHistory channel="gmc" />)
    expect(await screen.findByText('No changes made from this console yet.')).toBeInTheDocument()
  })
})

describe('JobRuns', () => {
  it('shows runs with labels, counts and errors', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(ok({ runs: [{ id: 'r1', kind: 'orders', started_at: '2026-03-01T10:00:00Z', status: 'partial', counts: { rows: 10 }, errors: [{ step: 'fetch', message: 'timeout' }] }] })))
    render(<JobRuns channel="amazon" labels={{ orders: 'Order sync' }} />)
    expect(await screen.findByText('Order sync')).toBeInTheDocument()
    expect(screen.getByText('rows 10')).toBeInTheDocument()
    expect(screen.getByText('fetch: timeout')).toBeInTheDocument()
    expect(screen.getByText('partial')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue(ok({ runs: [] })))
    render(<JobRuns channel="amazon" />)
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
  })
})
