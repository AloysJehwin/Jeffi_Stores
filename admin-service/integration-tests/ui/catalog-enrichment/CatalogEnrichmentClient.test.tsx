import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/catalog-enrichment', useSearchParams: () => sp }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/admin/enrichment/ProposedFills', () => ({ ProposedFills: () => <div>proposed-fills</div> }))
vi.mock('@admin/app/(admin)/admin/catalog-enrichment/EnrichmentOverview', () => ({ default: () => <div>enrichment-overview</div> }))
vi.mock('@admin/app/(admin)/admin/catalog-enrichment/EntityEnrichmentPanel', () => ({ default: () => <div>entity-panel</div> }))
vi.mock('@admin/app/(admin)/admin/products/_components/catalog-overview', () => ({
  useListTab: () => 'list',
  TabLinks: ({ actions, active }: any) => <div>tabs:{active}{actions}</div>,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="status" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))

import CatalogEnrichmentPage from '@admin/app/(admin)/admin/catalog-enrichment/CatalogEnrichmentClient'

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1', product_id: 'p1', product_name: 'Cordless Drill', product_slug: 'drill', source_desc: 'Old text',
  ai_description: 'A powerful drill for home use', ai_use_cases: ['drilling', 'screwing'], ai_keywords: ['drill'],
  ai_who_uses_it: 'DIY users', ai_application: 'Home repair', ai_product_type: 'Power tool', ai_features: ['18V'],
  ai_search_tags: ['tool'], model: 'gpt-x', status: 'proposed', proposed_at: '2026-03-01T10:00:00Z', promoted_at: null, error: null, ...over,
})
const items = [item(), item({ id: 'i2', product_id: 'p2', product_name: 'Hammer', ai_product_type: null, ai_use_cases: [], error: 'Embed failed' })]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body })

describe('CatalogEnrichmentPage', () => {
  beforeEach(() => {
    sp = new URLSearchParams()
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    showToast.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(true, { processed: 2, reEmbedded: true, message: 'Queued 9 products' })
      return json(true, { items, total: 2 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('lists proposed suggestions with product, type, model, tags and status', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    expect(await screen.findByRole('link', { name: 'Cordless Drill' })).toHaveAttribute('href', expect.stringContaining('/admin/products/p1'))
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/catalog-enrichment?status=proposed&page=1&pageSize=25')
    expect(screen.getByText('Power tool')).toBeInTheDocument()
    expect(screen.getAllByText('gpt-x').length).toBe(2)
    expect(screen.getByText('drilling')).toBeInTheDocument()
    expect(screen.getAllByText('proposed').length).toBe(2)
  })

  it('shows the empty state for an empty queue', async () => {
    fetchMock.mockResolvedValue(json(true, { items: [], total: 0 }))
    render(asAdmin(<CatalogEnrichmentPage />))
    expect(await screen.findByText('Nothing in the proposed queue.')).toBeInTheDocument()
  })

  it('shows the error state with retry when loading fails', async () => {
    fetchMock.mockResolvedValueOnce(json(false, { error: 'DB down' }))
    render(asAdmin(<CatalogEnrichmentPage />))
    const retry = await screen.findByRole('button', { name: 'Retry' })
    fetchMock.mockResolvedValue(json(true, { items, total: 2 }))
    fireEvent.click(retry)
    expect(await screen.findByRole('link', { name: 'Cordless Drill' })).toBeInTheDocument()
  })

  it('expands a row to show the AI detail and embed error', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Hammer')
    fireEvent.click(screen.getAllByTitle('Expand')[1])
    expect(screen.getByText('Embed Error')).toBeInTheDocument()
    expect(screen.getByText('Embed failed')).toBeInTheDocument()
    fireEvent.click(screen.getAllByTitle('Expand')[0])
    expect(screen.getAllByText('Original Description').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Home repair').length).toBeGreaterThan(0)
    expect(screen.getAllByText('proposed-fills').length).toBe(2)
  })

  it('approves one item, posts to the approve endpoint and removes it from the queue', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getAllByTitle('Approve')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Approved + re-embedded', 'success'))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/catalog-enrichment/i1/approve' && c[1]?.method === 'POST')).toBe(true)
    await waitFor(() => expect(screen.queryByText('Cordless Drill')).not.toBeInTheDocument())
  })

  it('rejects one item, and toasts the server error when it fails', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getAllByTitle('Reject')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rejected', 'success'))
    fetchMock.mockImplementation(async (_u: string, init?: any) => (init?.method === 'POST' ? json(false, { error: 'Nope' }) : json(true, { items, total: 2 })))
    fireEvent.click(screen.getAllByTitle('Approve')[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'))
  })

  it('selects all and bulk-approves with the selected ids', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByLabelText('Select all loaded rows'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Approved 2 items', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/catalog-enrichment/bulk-approve')!
    expect(JSON.parse(post[1].body)).toEqual({ ids: ['i1', 'i2'], action: 'approve' })
    await waitFor(() => expect(screen.getByText('Nothing in the proposed queue.')).toBeInTheDocument())
  })

  it('bulk reject posts the reject action', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Reject 1' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Rejected 2 items', 'success'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/catalog-enrichment/bulk-approve')!
    expect(JSON.parse(post[1].body)).toEqual({ ids: ['i1'], action: 'reject' })
  })

  it('Run All queues enrichment and toasts the message', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByRole('button', { name: 'Run All' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Queued 9 products', 'success'))
    expect(fetchMock.mock.calls.some(c => c[0] === '/api/admin/catalog-enrichment/run-all')).toBe(true)
  })

  it('changing the status filter refetches and drops the select-all column', async () => {
    render(asAdmin(<CatalogEnrichmentPage />))
    await screen.findByText('Cordless Drill')
    fireEvent.change(screen.getByLabelText('status'), { target: { value: 'approved' } })
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('status=approved'))).toBe(true))
    await screen.findByText('Cordless Drill')
    expect(screen.queryByLabelText('Select all loaded rows')).not.toBeInTheDocument()
  })

  it('renders the entities panel for ?tab=entities and hides write actions without the scope', async () => {
    sp = new URLSearchParams('tab=entities')
    const { unmount } = render(asAdmin(<CatalogEnrichmentPage />))
    expect(screen.getByText('entity-panel')).toBeInTheDocument()
    unmount()
    sp = new URLSearchParams()
    render(asMember(<CatalogEnrichmentPage />, ['catalog_enrichment:read']))
    await screen.findByText('Cordless Drill')
    expect(screen.queryByRole('button', { name: 'Run All' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Approve')).not.toBeInTheDocument()
  })
})
