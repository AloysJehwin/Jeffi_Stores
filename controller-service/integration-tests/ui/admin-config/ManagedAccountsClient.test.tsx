import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

import ManagedAccountsClient from '@controller/app/(admin)/admin/ecom/google-ads/ManagedAccountsClient'

const account = (over: Record<string, unknown> = {}) => ({
  customerId: '1234567890', name: 'Acme Ads', status: 'ENABLED', linkStatus: 'ACTIVE', testAccount: false, currency: 'INR', spend30d: 12500, clicks30d: 340, conversions30d: 12.34, spendError: null,
  stores: [{ name: 'Acme Store' }], ...over,
})
const mockFetch = (accounts: any[] | { ok: false; error: string }, del?: { ok: boolean; body: any }) => {
  const f = vi.fn<(...a: any[]) => any>(async (_u: string, init?: any) => {
    if (init?.method === 'DELETE') return { ok: del?.ok ?? true, json: async () => del?.body ?? { disconnected: [{ name: 'Acme Store' }] } }
    if (!Array.isArray(accounts)) return { ok: false, json: async () => ({ error: accounts.error }) }
    return { ok: true, json: async () => ({ accounts }) }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const view = (configured = true) =>
  render(
    <ToastProvider>
      <ManagedAccountsClient managerId="9998887776" configured={configured} />
    </ToastProvider>,
  )

describe('Admin ManagedAccountsClient', () => {
  it('warns about the missing credentials and does not call the API when not configured', () => {
    const f = mockFetch([])
    view(false)
    expect(screen.getByText(/Set GOOGLE_ADS_DEVELOPER_TOKEN/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('lists client accounts with store, status, spend, clicks and conversions plus a total', async () => {
    mockFetch([account(), account({ customerId: '5550001112', name: null, stores: [], linkStatus: 'PENDING', spend30d: null, spendError: 'quota', clicks30d: null, conversions30d: null, testAccount: true })])
    view()
    expect((await screen.findAllByText('Acme Ads')).length).toBeGreaterThan(0)
    expect(screen.getByText(/2 accounts/)).toHaveTextContent(/12,500/)
    expect(screen.getAllByText('123-456-7890').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Acme Store').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Not connected to a store/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/enabled/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/link pending/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('error').length).toBeGreaterThan(0)
    expect(screen.getByText('12.3')).toBeInTheDocument()
    expect(screen.getByText('(test)')).toBeInTheDocument()
  })

  it('shows the empty message when the manager has no clients', async () => {
    mockFetch([])
    view()
    expect((await screen.findAllByText('No client accounts under the manager yet.')).length).toBeGreaterThan(0)
  })

  it('shows the API error', async () => {
    mockFetch({ ok: false, error: 'Manager token expired' })
    view()
    expect(await screen.findByText('Manager token expired')).toBeInTheDocument()
  })

  it('unlinking asks to confirm, mentions the store, deletes, then reloads', async () => {
    const f = mockFetch([account()])
    view()
    await screen.findAllByText('Acme Ads')
    const table = screen.getAllByRole('table')[0]
    fireEvent.click(within(table).getByRole('button', { name: 'Unlink from the manager' }))
    expect(within(table).getByText(/Unlink and disconnect the store\?/)).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Cancel' }))
    expect(within(table).queryByText(/Unlink and disconnect/)).toBeNull()
    fireEvent.click(within(table).getByRole('button', { name: 'Unlink from the manager' }))
    fireEvent.click(within(table).getByRole('button', { name: 'Unlink' }))
    expect(await screen.findByText(/Unlinked 123-456-7890\. Disconnected: Acme Store\./)).toBeInTheDocument()
    const del = f.mock.calls.find(c => c[1]?.method === 'DELETE')!
    expect(del[0]).toBe('/api/admin/ecom/google-ads/1234567890')
    expect(f.mock.calls.filter(c => !c[1]?.method).length).toBeGreaterThanOrEqual(2)
  })

  it('shows the error when unlinking fails', async () => {
    mockFetch([account({ stores: [] })], { ok: false, body: { error: 'Still has active campaigns' } })
    view()
    await screen.findAllByText('Acme Ads')
    const table = screen.getAllByRole('table')[0]
    fireEvent.click(within(table).getByRole('button', { name: 'Unlink from the manager' }))
    expect(within(table).getByText(/^Unlink\?/)).toBeInTheDocument()
    fireEvent.click(within(table).getByRole('button', { name: 'Unlink' }))
    expect(await screen.findByText('Still has active campaigns')).toBeInTheDocument()
  })
})
