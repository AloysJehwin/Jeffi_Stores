import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastContext'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<(...a: any[]) => any>(), replace: vi.fn<(...a: any[]) => any>() }),
  usePathname: () => '/admin/ecom/domains',
  useSearchParams: () => new URLSearchParams(),
}))

import DomainsClient from '@controller/app/(admin)/admin/ecom/domains/DomainsClient'

const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString()
const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', tenantId: 't1', slug: 'acme', storeName: 'Acme Store', domain: 'acme.com', status: 'active', step: 'done', contactVerified: true, lastError: null,
  registeredAt: '2026-01-10T00:00:00Z', expiresAt: in30, renewal: null, autoRenew: true, costUsd: 15, usdInr: 84, priceInr: 1600, refundedInr: 0, renewedInr: 0, renewedCostUsd: 0, margin: 0.2, ...over,
})
const settings = (over: Record<string, unknown> = {}) => ({ marginPct: 25, renewLeadDays: 30, renewCutoffDays: 3, tlds: ['com', 'in'], ...over })
const view = (over: Record<string, unknown> = {}) => ({ domains: [row()], settings: settings(), defaults: settings(), live: true, usdInr: 84, ...over })
const mockFetch = (get: any, put?: { ok: boolean; body: any }) => {
  const f = vi.fn<(...a: any[]) => any>(async (_u: string, init?: any) => {
    if (init?.method === 'PUT') return { ok: put?.ok ?? true, json: async () => put?.body ?? { settings: settings() } }
    return { ok: true, json: async () => get }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const renderIt = () =>
  render(
    <ToastProvider>
      <DomainsClient />
    </ToastProvider>,
  )

describe('Admin DomainsClient', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows a placeholder, then KPIs and the bought domains with store link and margin', async () => {
    mockFetch(view())
    const { container } = renderIt()
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect((await screen.findAllByText('acme.com')).length).toBeGreaterThan(0)
    expect(screen.getByText('Live domains')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,600').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Acme Store' })[0]).toHaveAttribute('href', '/admin/ecom/customers/t1/view')
    expect(screen.getAllByText('active').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/opens /).length).toBeGreaterThan(0)
  })

  it('notes the fake registrar outside production', async () => {
    mockFetch(view({ live: false }))
    renderIt()
    expect(await screen.findByText(/Registrar: fake/)).toBeInTheDocument()
  })

  it('shows the empty message when no store bought a domain', async () => {
    mockFetch(view({ domains: [] }))
    renderIt()
    expect(await screen.findByText('No store has bought a domain yet.')).toBeInTheDocument()
  })

  it('flags failed, unconfirmed and at-risk renewals', async () => {
    const domains = [
      row({ id: 'a', domain: 'bad.com', status: 'failed', lastError: 'registrar refused' }),
      row({ id: 'b', domain: 'new.com', contactVerified: false }),
      row({ id: 'c', domain: 'late.com', renewal: { status: 'due', attempts: 2, lastError: 'wallet short', priceInr: 1700, costUsd: 16 } }),
    ]
    mockFetch(view({ domains }))
    renderIt()
    await screen.findAllByText('bad.com')
    expect(screen.getByText('1 failed (refunded)')).toBeInTheDocument()
    expect(screen.getAllByText('email unconfirmed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 tries').length).toBeGreaterThan(0)
    let box: HTMLElement | null = screen.getByText('Renewals at risk')
    while (box && !/wallet short/.test(box.textContent ?? '')) box = box.parentElement
    expect(box).toHaveTextContent(/Renewals at risk\s*1\s*wallet short/)
  })

  it('shows the example yearly price from margin and rate, and the current margin once edited', async () => {
    mockFetch(view())
    renderIt()
    await screen.findAllByText('acme.com')
    expect(screen.getByText(/Example: a \$15.00 .com is/)).toHaveTextContent('₹1,575/year at 25% and ₹84/$')
    fireEvent.change(screen.getByLabelText('Margin (%)'), { target: { value: '50' } })
    expect(screen.getByText(/Example: a \$15.00 .com is/)).toHaveTextContent('₹1,890/year at 50% and ₹84/$ (now 25%)')
  })

  it('saves margin, windows and the TLD list as arrays', async () => {
    const f = mockFetch(view(), { ok: true, body: { settings: settings({ marginPct: 30 }) } })
    renderIt()
    await screen.findAllByText('acme.com')
    fireEvent.change(screen.getByLabelText('Margin (%)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('TLDs offered, in order'), { target: { value: 'com, in  shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Saved. New searches and renewals use the new margin/)).toBeInTheDocument()
    const put = f.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(put[0]).toBe('/api/admin/ecom/domains')
    expect(JSON.parse(put[1].body)).toEqual({ marginPct: 30, renewLeadDays: 30, renewCutoffDays: 3, tlds: ['com', 'in', 'shop'] })
  })

  it('shows the server error when saving fails', async () => {
    mockFetch(view(), { ok: false, body: { error: 'Unknown TLD' } })
    renderIt()
    await screen.findAllByText('acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Unknown TLD')).toBeInTheDocument()
  })

  it('without write access the settings are read-only', async () => {
    canWrite = false
    mockFetch(view())
    renderIt()
    await screen.findAllByText('acme.com')
    expect(screen.getByLabelText('Margin (%)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
