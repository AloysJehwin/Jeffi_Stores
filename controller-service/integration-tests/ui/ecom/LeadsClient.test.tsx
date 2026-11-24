import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

import LeadsClient from '@controller/app/(ecom)/ecom/dashboard/showcase/[siteId]/leads/LeadsClient'

const lead = (over: Record<string, unknown> = {}) => ({ id: 'l1', name: 'Priya Sharma', email: 'priya@example.com', phone: '+919876543210', message: 'Do you ship to Pune?', createdAt: '2026-11-20T10:00:00Z', readAt: null, ...over })
const page = (over: Record<string, unknown> = {}) => ({ leads: [lead(), lead({ id: 'l2', name: 'Ravi', email: null, phone: null, message: null, readAt: '2026-11-21T10:00:00Z' })], total: 2, unread: 1, ...over }) as any
const view = (initial = page(), pageSize = 20) =>
  render(
    <ToastProvider>
      <LeadsClient initial={initial} pageSize={pageSize} siteId="s1" tenantSlug="acme ws" />
    </ToastProvider>,
  )
const mockFetch = (ok: boolean, body: any) => {
  const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

describe('LeadsClient', () => {
  it('lists enquiries with contact links, marking open and handled ones', () => {
    view()
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    expect(screen.getByText('Do you ship to Pune?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+919876543210' })).toHaveAttribute('href', expect.stringContaining('tel:'))
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', expect.stringContaining('wa.me'))
    expect(screen.getByRole('link', { name: 'priya@example.com' })).toHaveAttribute('href', 'mailto:priya@example.com')
    expect(screen.getByRole('img', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByText(/Handled /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument()
  })

  it('marks one enquiry handled and drops the open count', async () => {
    const f = mockFetch(true, { changed: 1 })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Open (0)' })).toBeInTheDocument())
    expect(f.mock.calls[0][0]).toBe('/api/ecom/showcase/s1/leads?tenant=acme%20ws')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'read', ids: ['l1'] })
    expect(screen.queryByRole('button', { name: 'Mark all handled' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Reopen' })).toHaveLength(2)
  })

  it('reopens a handled enquiry', async () => {
    const f = mockFetch(true, { changed: 1 })
    view(page({ leads: [lead({ readAt: '2026-11-21T10:00:00Z' })], unread: 0, total: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Open (1)' })).toBeInTheDocument())
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'unread', ids: ['l1'] })
  })

  it('marks everything handled in one request', async () => {
    const f = mockFetch(true, { changed: 1 })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all handled' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Open (0)' })).toBeInTheDocument())
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ action: 'read', ids: 'all' })
  })

  it('toasts when updating fails', async () => {
    mockFetch(false, { error: 'Not allowed' })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))
    expect(await screen.findByText('Not allowed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open (1)' })).toBeInTheDocument()
  })

  it('filters to open enquiries through the API, with a handled-everything empty state', async () => {
    const f = mockFetch(true, { leads: [], total: 2, unread: 0 })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'Open (1)' }))
    expect(await screen.findByText('No open enquiries. Everything is handled.')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/ecom/showcase/s1/leads?tenant=acme%20ws&offset=0&unread=1')
  })

  it('shows the no-enquiries-yet empty state', () => {
    view(page({ leads: [], total: 0, unread: 0 }))
    expect(screen.getByText(/No enquiries yet. They appear here when visitors use the contact form/)).toBeInTheDocument()
  })

  it('loads more and appends them', async () => {
    const f = mockFetch(true, { leads: [lead({ id: 'l3', name: 'Third', readAt: '2026-11-22T00:00:00Z' })], total: 3, unread: 1 })
    view(page({ total: 3 }), 1)
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(await screen.findByText('Third')).toBeInTheDocument()
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toContain('&offset=2')
  })

  it('toasts a load failure', async () => {
    mockFetch(false, { error: 'Could not load enquiries' })
    view()
    fireEvent.click(screen.getByRole('button', { name: 'All (2)' }))
    expect(await screen.findByText('Could not load enquiries')).toBeInTheDocument()
    expect(within(document.body).getByText('Priya Sharma')).toBeInTheDocument()
  })
})
