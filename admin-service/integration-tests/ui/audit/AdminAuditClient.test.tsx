import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin } from '../_support'

const push = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/admin/audit', useSearchParams: () => sp }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
let filterQuery = ''
vi.mock('@/components/admin/kit/list-filters', () => ({
  useFilterQuery: () => filterQuery,
  ListFilters: ({ entity, exportable }: any) => <div>filters:{entity}:{String(exportable)}</div>,
}))
vi.mock('@admin/app/(admin)/admin/audit/AuditLoadingParts', () => ({ LogRowsSkeleton: () => <div>log-skeleton</div> }))
vi.mock('@/components/admin/channels/ui', () => ({
  Tabs: ({ tabs, onChange, actions }: any) => (
    <div>
      {tabs.map((t: any) => <button key={t.id} onClick={() => onChange(t.id)}>{t.label}</button>)}
      {actions}
    </div>
  ),
}))
vi.mock('@/components/ui/IconButton', () => ({ default: ({ label, onClick }: any) => <button onClick={onClick}>{label}</button> }))

import AdminAuditClient from '@admin/app/(admin)/admin/audit/AdminAuditClient'

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()
const ev = (over: Record<string, unknown> = {}) => ({
  id: 'e1', admin_id: 'a1', action: 'update', entity_type: 'coupons', entity_id: 'c1', summary: 'Updated coupon "SAVE10"',
  diff: { discount: { from: 10, to: 15 }, active: { from: false, to: true }, note: { from: null, to: 'x'.repeat(80) }, brand: { from: 'b1', to: 'b2', fromLabel: 'Bosch', toLabel: 'Makita' } },
  metadata: null, ip_address: '1.2.3.4', created_at: ago(30), admin_first_name: 'Asha', admin_last_name: 'Rao', admin_username: 'asha', ...over,
})
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })
let events: any[]
let cron: any[]

describe('AdminAuditClient', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    filterQuery = ''
    push.mockReset()
    showToast.mockReset()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    events = [ev(), ev({ id: 'e2', admin_id: null, admin_first_name: null, admin_last_name: null, admin_username: null, action: 'create', diff: null, summary: 'Cron created', ip_address: null, created_at: ago(7200) })]
    cron = [
      { id: 'j1', name: 'Abandoned carts', path: '/api/cron/carts', intervalMs: 1, intervalLabel: 'every 5m', tenantScope: null, inPlan: true, enabled: true, lastRun: ago(60), lastStatus: 'ok', lastError: null, log: [{ t: ago(60), ok: true, detail: { sent: 3 } }, { t: ago(400), ok: false, err: 'boom' }] },
      { id: 'j2', name: 'Reports', path: '/api/cron/reports', intervalMs: 1, intervalLabel: 'daily', tenantScope: null, inPlan: false, enabled: false, lastRun: null, lastStatus: null, lastError: null, log: [] },
      { id: 'j3', name: 'Sync', path: '/api/cron/sync', intervalMs: 1, intervalLabel: 'hourly', tenantScope: null, inPlan: true, enabled: false, lastRun: null, lastStatus: 'error', lastError: 'timeout', log: [] },
    ]
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/audit/mail-log/')) return json(true, { row: { body_html: '<p>Hello</p>', body_text: null, metadata: null } })
      if (url.startsWith('/api/admin/audit/mail-log?')) return json(true, { rows: [
        { id: 'm1', email: 'a@x.test', from_email: 'shop@x.test', cc: 'cc@x.test', bcc: null, subject: 'Order shipped', template_name: 'shipped', kind: 'order', entity_type: 'orders', entity_id: 'abcdef123456', status: 'sent', error: null, sent_at: '2026-03-01T10:00:00Z', message_id: '<id1>', body_size: 10 },
        { id: 'm2', email: 'b@x.test', from_email: null, cc: null, bcc: null, subject: '', template_name: null, kind: 'otp', entity_type: null, entity_id: null, status: 'failed', error: 'SMTP down', sent_at: '2026-03-01T11:00:00Z', message_id: null, body_size: 0 },
      ], total: 2, window: { from: '2026-02-01', days: 30 }, capped: true })
      if (url.startsWith('/api/admin/audit/message-log?')) {
        const wa = url.includes('channel=whatsapp')
        return json(true, { rows: [{ id: wa ? 'w1' : 's1', channel: wa ? 'whatsapp' : 'sms', to_number: '+919876543210', from_number: '+18722704479', body: 'Your order shipped', kind: 'order', status: 'sent', error: null, provider_sid: 'SM123', sent_at: '2026-03-01T10:00:00Z' },
          { id: wa ? 'w2' : 's2', channel: 'sms', to_number: '', from_number: null, body: null, kind: null, status: 'received', error: 'bad', provider_sid: null, sent_at: '2026-03-01T10:00:00Z' }], total: 2 })
      }
      if (url.startsWith('/api/admin/audit?')) return json(true, { events, total: events.length })
      if (url === '/api/admin/cron/status') return json(true, { jobs: cron })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists audit events with actor, relative time, ip, and a field diff', async () => {
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Updated coupon "SAVE10"')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/audit?page=1&pageSize=50')
    expect(screen.getByText('coupons.update')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('· 1.2.3.4')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
    expect(screen.getByText('2h ago')).toBeInTheDocument()
    expect(screen.getByText('"Bosch"', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('true', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('New record created')).toBeInTheDocument()
    expect(screen.getByText('filters:audit:true')).toBeInTheDocument()
  })

  it('shows the empty state text, with and without filters', async () => {
    events = []
    const { unmount } = render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('No audit events yet.')).toBeInTheDocument()
    unmount()
    filterQuery = 'action=delete'
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('No audit events match these filters.')).toBeInTheDocument()
  })

  it('collapses rapid same-product changes into a group with expandable cascading updates', async () => {
    events = [
      ev({ id: 'g1', entity_type: 'products', entity_id: 'p1', summary: 'Updated product "Drill"', diff: { price: { from: 1, to: 2 } } }),
      ev({ id: 'g2', entity_type: 'product_variants', entity_id: 'v1', summary: 'Updated variant 18V', metadata: { product_id: 'p1' }, diff: { sku: { from: 'a', to: 'b' } } }),
      ev({ id: 'g3', entity_type: 'product_images', entity_id: 'i1', summary: 'Uploaded image', metadata: { product_id: 'p1' }, diff: null, action: 'create' }),
    ]
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Updated product "Drill"')).toBeInTheDocument()
    expect(screen.getByText('also touched: 1 variant · 1 image')).toBeInTheDocument()
    expect(screen.queryByText('Updated variant 18V')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /2 cascading updates/ }))
    expect(screen.getByText('Updated variant 18V')).toBeInTheDocument()
  })

  it('collapses an image replacement into a before/after group', async () => {
    events = [
      ev({ id: 'i1', entity_type: 'product_images', action: 'create', summary: 'Added image to "Drill"', metadata: { product_id: 'p1', image_url: 'https://cdn/new.jpg', thumbnail_url: 'https://cdn/new-t.jpg', file_name: 'new.jpg' }, diff: null }),
      ev({ id: 'i2', entity_type: 'product_images', action: 'delete', summary: 'Removed image from "Drill"', metadata: { product_id: 'p1', image_url: 'https://cdn/old.jpg', thumbnail_url: 'https://cdn/old-t.jpg', file_name: 'old.jpg' }, diff: null }),
    ]
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Replaced image for "Drill"')).toBeInTheDocument()
    expect(screen.getByAltText('new.jpg')).toBeInTheDocument()
    expect(screen.getByAltText('old.jpg')).toBeInTheDocument()
  })

  it('groups purchase order header and item changes under the PO', async () => {
    events = [
      ev({ id: 'p1', entity_type: 'purchase_orders', entity_id: 'po1', summary: 'Updated PO "PO-9"', diff: null }),
      ev({ id: 'p2', entity_type: 'purchase_order_items', entity_id: 'x', summary: 'Item', metadata: { po_id: 'po1' }, diff: null }),
    ]
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Updated PO "PO-9"')).toBeInTheDocument()
    expect(screen.getByText('also touched: 1 purchase order items')).toBeInTheDocument()
  })

  it('switching tabs pushes the tab into the URL', async () => {
    render(asAdmin(<AdminAuditClient />))
    await screen.findByText('Updated coupon "SAVE10"')
    fireEvent.click(screen.getByRole('button', { name: 'Mail Log' }))
    expect(push).toHaveBeenCalledWith('/admin/audit?tab=mail_log&view=list', { scroll: false })
  })

  it('mail log: lists emails with the window note, expands to load and show the body', async () => {
    sp = new URLSearchParams('tab=mail_log')
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Order shipped')).toBeInTheDocument()
    expect(screen.getByText('(no subject)')).toBeInTheDocument()
    expect(screen.getByText(/Showing the last 30 days/)).toBeInTheDocument()
    expect(screen.getByText(/Over 10,000 emails match|Over .* emails match/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Order shipped'))
    expect(await screen.findByTitle('mail-m1')).toHaveAttribute('srcdoc', '<p>Hello</p>')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/audit/mail-log/m1', { credentials: 'include' })
    expect(screen.getByText('cc@x.test')).toBeInTheDocument()
  })

  it('mail log: OTP bodies are redacted and failures show the error', async () => {
    sp = new URLSearchParams('tab=mail_log')
    render(asAdmin(<AdminAuditClient />))
    fireEvent.click(await screen.findByText('(no subject)'))
    expect(screen.getByText('SMTP down')).toBeInTheDocument()
    expect(screen.getByText(/Body redacted/)).toBeInTheDocument()
  })

  it('mail log: shows a placeholder when no body was recorded', async () => {
    sp = new URLSearchParams('tab=mail_log')
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/admin/audit/mail-log/') ? json(false) : url.startsWith('/api/admin/audit/mail-log?')
        ? json(true, { rows: [{ id: 'm1', email: 'a@x.test', from_email: null, cc: null, bcc: null, subject: 'Hi', template_name: null, kind: null, entity_type: null, entity_id: null, status: 'sent', error: null, sent_at: '2026-03-01T10:00:00Z', message_id: null, body_size: 1 }], total: 1 })
        : json(true, {}))
    render(asAdmin(<AdminAuditClient />))
    fireEvent.click(await screen.findByText('Hi'))
    expect(await screen.findByText('No body recorded for this email.')).toBeInTheDocument()
  })

  it('sms log: queries the sms channel and expands a message', async () => {
    sp = new URLSearchParams('tab=sms_log')
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('+919876543210')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('channel=sms'))).toBe(true)
    expect(screen.getByText('(no number)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('+919876543210'))
    expect(screen.getByText('SM123')).toBeInTheDocument()
    expect(screen.getByText('filters:logs.sms:true')).toBeInTheDocument()
  })

  it('whatsapp log: queries the whatsapp channel and shows no-body text for an empty message', async () => {
    sp = new URLSearchParams('tab=whatsapp_log')
    render(asAdmin(<AdminAuditClient />))
    await screen.findByText('+919876543210')
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('channel=whatsapp'))).toBe(true)
    fireEvent.click(screen.getByText('(no number)'))
    expect(screen.getByText('bad')).toBeInTheDocument()
    expect(screen.getByText('No body recorded for this message.')).toBeInTheDocument()
  })

  it('cron: lists jobs, flags jobs outside the plan and hides their controls', async () => {
    sp = new URLSearchParams('tab=cron')
    render(asAdmin(<AdminAuditClient />))
    expect(await screen.findByText('Abandoned carts')).toBeInTheDocument()
    expect(screen.getByText(/not in your plan/)).toBeInTheDocument()
    expect(screen.getByText(/last run ok/)).toBeInTheDocument()
    expect(screen.getByText(/last run failed/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Trigger now/ }).length).toBe(2)
    expect(screen.getAllByText('No runs recorded yet').length).toBe(1)
  })

  it('cron: toggles a job and toasts', async () => {
    sp = new URLSearchParams('tab=cron')
    render(asAdmin(<AdminAuditClient />))
    fireEvent.click(await screen.findByRole('button', { name: 'Enabled' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Job disabled', 'success'))
    const patch = fetchMock.mock.calls.find(c => c[0] === '/api/admin/cron/config')!
    expect(JSON.parse(patch[1].body)).toEqual({ jobId: 'j1', enabled: false })
    expect(await screen.findAllByRole('button', { name: 'Disabled' })).toHaveLength(2)
  })

  it('cron: triggers a job, reloads the status and shows its log entries', async () => {
    sp = new URLSearchParams('tab=cron')
    render(asAdmin(<AdminAuditClient />))
    await screen.findByText('Abandoned carts')
    fireEvent.click(screen.getAllByRole('button', { name: /Trigger now/ })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Job triggered', 'success'))
    expect(JSON.parse(fetchMock.mock.calls.find(c => c[0] === '/api/admin/cron/trigger')![1].body)).toEqual({ jobId: 'j1' })
    fireEvent.click(screen.getByRole('button', { name: 'Logs (2)' }))
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByText(/"sent": 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('cron: toasts an error when the trigger fails', async () => {
    sp = new URLSearchParams('tab=cron')
    fetchMock.mockImplementation(async (url: string) => (url === '/api/admin/cron/trigger' ? json(false) : url === '/api/admin/cron/status' ? json(true, { jobs: cron }) : json(true, {})))
    render(asAdmin(<AdminAuditClient />))
    await screen.findByText('Abandoned carts')
    fireEvent.click(screen.getAllByRole('button', { name: /Trigger now/ })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not trigger the job', 'error'))
  })
})
