import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Focused harness: the form's hooks and heavy sub-components are mocked; validation, the save
// request and the draft/lock notice are the real component.
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin/products/new',
}))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm: vi.fn() }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true), usePrompt: () => vi.fn() }))
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => <>{children}</>,
  RequireAi: ({ children }: any) => <>{children}</>,
  useCanWrite: () => true,
  useHasScope: () => true,
  useCanUseAi: () => true,
}))
let lockState: any
vi.mock('@/hooks/useDraftLock', () => ({ useDraftLock: () => lockState, lockSummary: () => 'Draft by Priya' }))
const editSave = vi.fn().mockResolvedValue(true)
vi.mock('@/hooks/useEditSession', () => ({ useEditSession: () => ({ sessionId: null, status: 'idle', save: editSave, cancel: vi.fn().mockResolvedValue(true) }) }))
vi.mock('@/components/admin/kit', async () => {
  const actual = await vi.importActual<any>('@/components/admin/kit')
  return {
    ...actual,
    DraftLockBanner: ({ lock }: any) => (lock.readOnly ? <div role="status">Read-only draft held by Priya</div> : lock.isMine ? <div role="status">You are editing this draft</div> : null),
  }
})
vi.mock('@/components/admin/AutosaveStatusPill', () => ({ default: ({ status }: any) => <span data-testid="pill">{status}</span> }))
vi.mock('@/components/admin/ImageUpload', () => ({ default: () => <div data-testid="image-upload" /> }))
vi.mock('@/components/admin/ImageGalleryEditor', () => ({ default: () => null }))
vi.mock('@/components/admin/GalleryPicker', () => ({ default: () => null }))
vi.mock('@/components/admin/ProductSupplierList', () => ({ default: () => null }))
vi.mock('@/components/admin/UnitsManager', () => ({ default: () => null }))
vi.mock('@/components/admin/DigitalFilesPanel', () => ({ default: () => null }))
vi.mock('@/components/admin/ai/AiMediaButton', () => ({ default: () => null }))
vi.mock('@/components/admin/drafts/MergeDialog', () => ({ default: () => null }))
vi.mock('@/components/admin/product-form/MediaManager', () => ({ default: () => null }))
vi.mock('@/components/admin/product-form/ProductExtraSections', () => ({ AiInsightsPanel: () => null, ExtraFieldsGroup: () => null, FaqEditor: () => null }))
vi.mock('@/components/admin/SubVariantEditor', async () => {
  const actual = await vi.importActual<any>('@/components/admin/SubVariantEditor')
  return { ...actual, default: () => null }
})
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ id, value, options, onChange }: any) => (
    <select id={id} aria-label={id ?? 'select'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ui/DatePicker', () => ({ default: () => <input aria-label="date" /> }))

import ProductForm from '@/components/admin/ProductForm'

const fetchMock = vi.fn()
const mkLock = (o: any = {}) => ({ lock: null, loaded: true, isMine: true, claimable: false, readOnly: false, closed: false, viewers: [], epoch: 1, canTakeOver: false, canDiscard: true, busy: false, unsaved: null, setUnsaved: vi.fn(), markLocked: vi.fn(), refresh: vi.fn(), ...o })

const base = { categories: [{ id: 'c1', name: 'Fasteners', parent_category_id: null }], brands: [{ id: 'b1', name: 'Acme' }], backUrl: '/admin/products' }

beforeEach(() => {
  push.mockClear()
  showToast.mockClear()
  editSave.mockClear()
  lockState = mkLock()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ suppliers: [], locations: [] }) })
  vi.stubGlobal('fetch', fetchMock)
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
afterEach(() => vi.unstubAllGlobals())

const nameInput = () => screen.getByLabelText(/Product Name/)
const publish = () => screen.getByRole('button', { name: /Publish/ })

describe('ProductForm', () => {
  it('renders the tabs and the basics fields for a new product', () => {
    render(<ProductForm {...base} action={vi.fn()} />)
    for (const t of ['Basics', 'Pricing & stock', 'Images & media', 'Details & specs', 'SEO']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Variants' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Basics' })).toHaveAttribute('aria-selected', 'true')
    expect(nameInput()).toHaveValue('')
    expect(screen.getByRole('button', { name: /Save as Draft|Save Draft|Draft/i })).toBeInTheDocument()
    expect(publish()).toHaveTextContent('Save & Publish')
  })

  it('prefills an existing product and labels the publish button Update & Publish', () => {
    render(<ProductForm {...base} action={vi.fn()} productId="p1" product={{ name: 'Hex bolt', sku: 'HB-1', base_price: 1250, gst_percentage: '18', description: 'Steel' }} />)
    expect(nameInput()).toHaveValue('Hex bolt')
    expect(publish()).toHaveTextContent('Update & Publish')
    expect(screen.getByRole('tab', { name: 'Selling units' })).toBeInTheDocument()
  })

  it('switches tabs with the tab bar', () => {
    render(<ProductForm {...base} action={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'SEO' }))
    expect(screen.getByRole('tab', { name: 'SEO' })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-pf-tab="seo"]')).not.toHaveAttribute('hidden')
    expect(document.querySelector('[data-pf-tab="basics"]')).toHaveAttribute('hidden')
  })

  it('publishing without a selling price is blocked with an error banner and a toast, and never calls the action', async () => {
    const action = vi.fn()
    render(<ProductForm {...base} action={action} />)
    fireEvent.change(nameInput(), { target: { value: 'Hex bolt' } })
    fireEvent.click(publish())
    expect(await screen.findByText('Pricing: selling price is required to publish.')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Pricing: selling price is required to publish.', 'error')
    expect(action).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: /Pricing & stock/ })).toHaveTextContent('1')
  })

  it('derives MRP and selling price (incl. GST) from the ex-GST MRP', () => {
    render(<ProductForm {...base} action={vi.fn()} />)
    fireEvent.change(document.getElementById('discount_pct')!, { target: { value: '0' } })
    fireEvent.change(document.getElementById('mrp_ex_gst')!, { target: { value: '100' } })
    expect(document.getElementById('mrp')).toHaveValue(118)
    expect(document.getElementById('base_price')).toHaveValue(118)
  })

  it('saving a draft posts the form data with the draft intent and no price needed', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, redirectTo: '/admin/products' })
    render(<ProductForm {...base} action={action} draftId="d1" />)
    fireEvent.change(nameInput(), { target: { value: 'Hex bolt' } })
    fireEvent.click(screen.getByRole('button', { name: /Draft/i }))
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    const fd: FormData = action.mock.calls[0][0]
    expect(fd.get('name')).toBe('Hex bolt')
    expect(fd.get('intent')).toBe('draft')
    expect(fd.get('_draft_id')).toBe('d1')
    expect(fd.get('_no_redirect')).toBe('1')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Draft saved', 'success'))
    expect(push).toHaveBeenCalledWith('/admin/products')
    expect(editSave).not.toHaveBeenCalled()
  })

  it('shows the server error from the action and re-enables the buttons', async () => {
    const action = vi.fn().mockResolvedValue({ error: 'SKU already exists', details: [] })
    render(<ProductForm {...base} action={action} />)
    fireEvent.click(screen.getByRole('button', { name: /Draft/i }))
    expect(await screen.findByText('SKU already exists')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('SKU already exists', 'error')
    expect(publish()).toBeEnabled()
  })

  it('shows a thrown failure as a generic error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const action = vi.fn().mockRejectedValue(new Error('Network down'))
    render(<ProductForm {...base} action={action} />)
    fireEvent.click(screen.getByRole('button', { name: /Draft/i }))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    spy.mockRestore()
  })
})

describe('ProductForm draft and lock notices', () => {
  it('shows the lock banner for the holder', () => {
    render(<ProductForm {...base} action={vi.fn()} productId="p1" draftId="d1" isDraft product={{ name: 'Hex bolt' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('You are editing this draft')
  })

  it('locks every field when someone else holds the draft', () => {
    lockState = mkLock({ readOnly: true, isMine: false })
    render(<ProductForm {...base} action={vi.fn()} productId="p1" draftId="d1" isDraft product={{ name: 'Hex bolt' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Read-only draft held by Priya')
    expect(nameInput().closest('fieldset')).toBeDisabled()
    expect(nameInput()).toBeDisabled()
  })
})
