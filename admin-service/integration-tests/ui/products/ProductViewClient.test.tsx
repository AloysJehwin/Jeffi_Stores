import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/products/p1/view',
  useSearchParams: () => new URLSearchParams(),
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))
vi.mock('@/components/admin/DraftConfirmModal', () => ({ default: ({ productName, onClose }: any) => <div>draft-modal:{productName}<button onClick={onClose}>close-draft</button></div> }))
vi.mock('@/components/admin/ProductStockMovements', () => ({ default: ({ productId }: any) => <div>movements:{productId}</div> }))
vi.mock('@/components/admin/change-log', () => ({ ChangeLog: ({ kind, id }: any) => <div>changelog:{kind}:{id}</div> }))
vi.mock('@/components/media/ProductMediaGallery', () => ({ default: ({ emptyNode }: any) => <div>media-gallery{emptyNode}</div> }))
vi.mock('@/components/media/MediaItemView', () => ({ DocumentList: () => <div>documents</div> }))
vi.mock('@/lib/catalog/product-media-shared', () => ({ resolveMedia: (m: any[]) => m }))
const { base } = vi.hoisted(() => ({ base: '@admin/app/(admin)/admin/products/[id]/view/_components' }))
vi.mock(`${base}/ProductHeader`, () => ({
  ProductHeader: ({ p, heldDraft, canEnrich, onAi, onEdit }: any) => (
    <div>
      <h1>{p.name}</h1>
      {heldDraft && <p>held:{heldDraft.ownerName}</p>}
      {canEnrich && <button onClick={onAi}>open-ai</button>}
      <button onClick={onEdit}>edit-product</button>
    </div>
  ),
}))
vi.mock(`${base}/CollapsibleCard`, () => ({ CollapsibleCard: ({ title, children }: any) => <section><h2>{title}</h2>{children}</section> }))
vi.mock(`${base}/PricingCard`, () => ({ PricingCard: () => <div>pricing</div> }))
vi.mock(`${base}/ProductGallery`, () => ({ ProductGallery: ({ images }: any) => <div>fallback-gallery:{images.length}</div> }))
vi.mock(`${base}/DetailSections`, () => ({
  DetailSections: ({ variants }: any) => <div>details:{variants.length}</div>,
  Specifications: ({ specs }: any) => <div>specs:{Object.keys(specs).join(',')}</div>,
}))
vi.mock(`${base}/SupplierDetailsCard`, () => ({ SupplierDetailsCard: ({ productId }: any) => <div>suppliers:{productId}</div> }))
vi.mock(`${base}/ShelfBadges`, () => ({ ShelfBadges: ({ rows }: any) => <div>shelves:{rows.map((r: any) => r.location_display_code).join(',')}</div> }))
vi.mock(`${base}/VariantsTable`, () => ({
  VariantsTable: ({ variants, canWrite, status }: any) => (
    <div>
      variants:{variants.length}:{String(canWrite)}
      <button onClick={() => status.toggle('v1', '/api/admin/products/p1/variants/v1', false)}>toggle-v1</button>
    </div>
  ),
}))
vi.mock(`${base}/ai`, () => ({
  AiIntelligenceCard: () => <div>ai-card</div>,
  AiEnrichmentDialog: ({ onClose, onApproved }: any) => <div>ai-dialog<button onClick={onClose}>close-ai</button><button onClick={onApproved}>approve-ai</button></div>,
}))
vi.mock(`${base}/ProductViewLoading`, () => ({ default: () => <div>product-loading</div> }))

import ProductViewClient from '@admin/app/(admin)/admin/products/[id]/view/ProductViewClient'

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Power Drill', sku: 'DR-1', is_active: true, has_variants: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
  short_description: 'Cordless', specifications: { Voltage: '18V' }, product_images: [{ id: 'i1' }], media: [],
  product_variants: [{ id: 'v1', name: '18V' }, { id: 'v2', name: '12V' }], ...over,
})
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let prod: any

describe('ProductViewClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prod = product()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/products/p1') return json(true, prod)
      if (url.startsWith('/api/admin/shelving/stock')) return json(true, { locations: [{ location_display_code: 'A-1' }] })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
  })

  it('shows the loading skeleton, then the product with its cards', async () => {
    render(asAdmin(<ProductViewClient id="p1" draftsPanel={<div>drafts-panel</div>} />))
    expect(screen.getByText('product-loading')).toBeInTheDocument()
    expect(await screen.findByText('Power Drill')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/p1', { credentials: 'include' })
    expect(screen.getByText('drafts-panel')).toBeInTheDocument()
    expect(screen.getByText('details:2')).toBeInTheDocument()
    expect(screen.getByText('specs:Voltage')).toBeInTheDocument()
    expect(screen.getByText('Cordless')).toBeInTheDocument()
    expect(screen.getByText('pricing')).toBeInTheDocument()
    expect(screen.getByText('suppliers:p1')).toBeInTheDocument()
    expect(screen.getByText('movements:p1')).toBeInTheDocument()
    expect(screen.getByText('changelog:product:p1')).toBeInTheDocument()
    expect(screen.getByText('fallback-gallery:1')).toBeInTheDocument()
    expect(screen.getByText(/Created/)).toBeInTheDocument()
  })

  it('shows the not-found state with a link back when the product is missing or errors', async () => {
    prod = { error: 'Not found' }
    render(asAdmin(<ProductViewClient id="p1" />))
    expect(await screen.findByText('Product not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Products' })).toHaveAttribute('href', expect.stringContaining('/admin/products'))
  })

  it('hides the inventory-only cards when the store has no inventory module', async () => {
    render(asAdmin(<ProductViewClient id="p1" hasInventory={false} />))
    await screen.findByText('Power Drill')
    expect(screen.queryByText('suppliers:p1')).not.toBeInTheDocument()
    expect(screen.queryByText('movements:p1')).not.toBeInTheDocument()
  })

  it('omits the specs, description and variants table when the product has none', async () => {
    prod = product({ specifications: {}, short_description: '', has_variants: false })
    render(asAdmin(<ProductViewClient id="p1" />))
    await screen.findByText('Power Drill')
    expect(screen.queryByText(/^specs:/)).not.toBeInTheDocument()
    expect(screen.queryByText('Short Description')).not.toBeInTheDocument()
    expect(screen.queryByText(/^variants:/)).not.toBeInTheDocument()
  })

  it('shows the variants table with write access and a working status toggle', async () => {
    render(asAdmin(<ProductViewClient id="p1" />))
    expect(await screen.findByText('variants:2:true')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'toggle-v1' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PATCH')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/admin/products/p1/variants/v1')
    expect(JSON.parse(init.body)).toEqual({ is_active: false })
  })

  it('a failed status toggle toasts the server error', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'PATCH') return json(false, { error: 'Cannot deactivate' }, 400)
      return url === '/api/admin/products/p1' ? json(true, prod) : json(true, {})
    })
    render(asAdmin(<ProductViewClient id="p1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'toggle-v1' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Cannot deactivate', 'error'))
  })

  it('variants are read-only without products write access', async () => {
    render(asMember(<ProductViewClient id="p1" />, ['products:read']))
    expect(await screen.findByText('variants:2:false')).toBeInTheDocument()
  })

  it('lists shelf locations only with the shelving scope', async () => {
    const { unmount } = render(asAdmin(<ProductViewClient id="p1" />))
    expect(await screen.findByText('shelves:A-1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/shelving/stock?product_id=p1', { credentials: 'include' })
    unmount()
    fetchMock.mockClear()
    render(asMember(<ProductViewClient id="p1" />, ['products:read']))
    await screen.findByText('Power Drill')
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('shelving'))).toBe(false)
    expect(screen.queryByText(/^shelves:/)).not.toBeInTheDocument()
  })

  it('Edit opens the draft confirmation modal and closing dismisses it', async () => {
    render(asAdmin(<ProductViewClient id="p1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'edit-product' }))
    expect(screen.getByText('draft-modal:Power Drill')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close-draft' }))
    expect(screen.queryByText(/draft-modal/)).not.toBeInTheDocument()
  })

  it('passes a held draft to the header', async () => {
    render(asAdmin(<ProductViewClient id="p1" heldDraft={{ ownerName: 'Priya' } as any} />))
    expect(await screen.findByText('held:Priya')).toBeInTheDocument()
  })

  it('the AI dialog needs the enrichment scope; approving closes it and reloads the product', async () => {
    render(asAdmin(<ProductViewClient id="p1" />))
    fireEvent.click(await screen.findByRole('button', { name: 'open-ai' }))
    expect(screen.getByText('ai-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'approve-ai' }))
    expect(screen.queryByText('ai-dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/admin/products/p1').length).toBe(2))
  })

  it('hides the AI action without the catalog enrichment scope', async () => {
    render(asMember(<ProductViewClient id="p1" />, ['products:read']))
    await screen.findByText('Power Drill')
    expect(screen.queryByRole('button', { name: 'open-ai' })).not.toBeInTheDocument()
  })

  it('warns when the publish left a stock-assignment error behind', async () => {
    sessionStorage.setItem('bootstrap_stock_error', 'Shelf full.')
    render(asAdmin(<ProductViewClient id="p1" />))
    await screen.findByText('Power Drill')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('existing stock was not assigned: Shelf full.'), 'warning'))
    expect(sessionStorage.getItem('bootstrap_stock_error')).toBeNull()
  })
})
