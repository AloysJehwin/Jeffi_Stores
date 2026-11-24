import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import ListingsMapper from '@/components/admin/marketplace/ListingsMapper'
import { renderAs, res, routeFetch, bodyOf, callsTo } from './marketplace-kit'

// ListingsMapper: every sellable unit with its marketplace SKU / style ID. Edit by hand and save, or upload
// the portal's SKU report; select units to fill a template, build an image pack or submit through the API.
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }), useToast: () => ({ showToast }) }))

const unit = (over: Record<string, unknown> = {}) => ({
  key: 'u1',
  name: 'Cordless Drill',
  variantName: '18V',
  subVariantName: null,
  ourSku: 'DRL-18',
  price: 4999,
  image: null,
  imageCount: 2,
  listing: null,
  ...over,
})
const listing = (over: Record<string, unknown> = {}) => ({ status: 'live', marketplaceSku: 'MP-1', styleId: 'ST-1', listedPrice: 4999, issues: [], ...over })

const payload = (over: Record<string, unknown> = {}) => ({
  units: [
    unit({ listing: listing() }),
    unit({ key: 'u2', name: 'Hammer', variantName: null, ourSku: 'HAM-1', imageCount: 0, listing: null }),
    unit({ key: 'u3', name: 'Saw', ourSku: 'SAW-1', listing: listing({ status: 'rejected', marketplaceSku: 'MP-3', styleId: null, issues: ['Missing colour', 'Bad image'] }) }),
  ],
  tasks: [],
  categories: ['Tools'],
  attributeKeys: ['colour'],
  submitSupported: true,
  imageSpec: { maxImages: 6, maxPerPack: 50 },
  ...over,
})

const BASE = '/api/admin/myntra/listings'

describe('ListingsMapper', () => {
  beforeEach(() => {
    showToast.mockClear()
    URL.createObjectURL = vi.fn(() => 'blob:x') as any
    URL.revokeObjectURL = vi.fn() as any
  })

  it('lists units with their status summary, photos and mapped SKUs', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />)
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    expect(screen.getByText('Listings (3)')).toBeInTheDocument()
    expect(screen.getByText(/1 live · 0 mapped · 0 submitted · 1 rejected · 1 not mapped/)).toBeInTheDocument()
    expect(screen.getByText('18V · DRL-18 · 2 photos')).toBeInTheDocument()
    expect(screen.getByText('HAM-1 · no photos')).toBeInTheDocument()
    expect(screen.getByLabelText('Myntra SKU for Cordless Drill')).toHaveValue('MP-1')
    expect(screen.getByLabelText('Style ID for Cordless Drill')).toHaveValue('ST-1')
    expect(screen.getByText('Not mapped')).toBeInTheDocument()
    expect(screen.getByText('Missing colour · Bad image')).toBeInTheDocument()
  })

  it('shows the load error as a banner', async () => {
    routeFetch([[BASE, res({ error: 'Catalogue unavailable' }, false)]])
    renderAs(<ListingsMapper channel="myntra" />)
    expect(await screen.findByText('Catalogue unavailable')).toBeInTheDocument()
  })

  it('says when there are no sellable products at all', async () => {
    routeFetch([[BASE, res(payload({ units: [] }))]])
    renderAs(<ListingsMapper channel="myntra" />)
    expect(await screen.findByText('No sellable products yet.')).toBeInTheDocument()
  })

  it('filters by search text and by status', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.change(screen.getByPlaceholderText('Search name or SKU'), { target: { value: 'ham' } })
    expect(screen.queryByText('Cordless Drill')).toBeNull()
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search name or SKU'), { target: { value: 'zzz' } })
    expect(screen.getByText('No units match.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search name or SKU'), { target: { value: '' } })
    fireEvent.click(screen.getAllByRole('combobox')[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Rejected' }))
    expect(screen.queryByText('Cordless Drill')).toBeNull()
    expect(screen.getByText('Saw')).toBeInTheDocument()
  })

  it('saves edited mappings with a PUT and reloads', async () => {
    const f = routeFetch([[BASE, (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? res({ saved: 1 }) : res(payload()))]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    const sku = screen.getByLabelText('Myntra SKU for Hammer')
    fireEvent.change(sku, { target: { value: 'MP-NEW' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Saved 1 mapping(s).', 'success'))
    expect(bodyOf(f, BASE, 1)).toEqual({ rows: [{ key: 'u2', marketplaceSku: 'MP-NEW', styleId: null }] })
    await waitFor(() => expect(callsTo(f, BASE).length).toBe(3))
  })

  it('treats an edit reverted to the saved value as no change', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    const sku = screen.getByLabelText('Myntra SKU for Cordless Drill')
    fireEvent.change(sku, { target: { value: 'X' } })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    fireEvent.change(sku, { target: { value: 'MP-1' } })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('toasts a save failure', async () => {
    routeFetch([[BASE, (_u: string, init?: RequestInit) => (init?.method === 'PUT' ? res({ error: 'Duplicate SKU' }, false) : res(payload()))]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.change(screen.getByLabelText('Myntra SKU for Hammer'), { target: { value: 'MP-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Duplicate SKU', 'error'))
  })

  it('is read-only for an admin without write access', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />, 'reader')
    await screen.findByText('Cordless Drill')
    expect(screen.getByLabelText('Myntra SKU for Hammer')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upload SKU report' })).toBeNull()
  })

  it('keeps bulk actions disabled until units are selected', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    expect(screen.getByRole('button', { name: 'Build image pack' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Submit to Myntra' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Select Hammer'))
    expect(screen.getByText(/· 1 selected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build image pack' })).toBeEnabled()
  })

  it('omits Submit when the marketplace has no submission API', async () => {
    routeFetch([[BASE, res(payload({ submitSupported: false }))]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    expect(screen.queryByRole('button', { name: /Submit to/ })).toBeNull()
  })

  it('builds an image pack for the selection and toasts the photo count', async () => {
    const f = routeFetch([
      ['/listings/images', res({}, true, { 'x-images': '4', 'x-failed': '0' })],
      [BASE, res(payload())],
    ])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByLabelText(/Select all 3/))
    fireEvent.click(screen.getByRole('button', { name: 'Build image pack' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Photos of the 3 selected unit\(s\)/)).toBeInTheDocument()
    expect(within(dialog).getByText(/white 3:4 canvas/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Build pack' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('4 photo(s) ready.', 'success'))
    expect(bodyOf(f, '/listings/images')).toEqual({ keys: ['u1', 'u2', 'u3'] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('submits the selection to the marketplace and clears it', async () => {
    const f = routeFetch([
      ['/listings/submit', res({ submitted: 2, tasks: [{}], skipped: ['x'] })],
      [BASE, res(payload())],
    ])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByLabelText('Select Hammer'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit to Myntra' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Submitted 2 listing(s) in 1 batch(es); 1 skipped.', 'success'))
    expect(bodyOf(f, '/listings/submit')).toEqual({ keys: ['u2'] })
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
  })

  it('toasts a submit failure and keeps the dialog open', async () => {
    routeFetch([
      ['/listings/submit', res({ error: 'Quota exceeded' }, false)],
      [BASE, res(payload())],
    ])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByLabelText('Select Hammer'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit to Myntra' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Quota exceeded', 'error'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('reads a SKU report, shows what would change and applies it', async () => {
    const preview = {
      headers: ['Seller SKU', 'Myntra SKU'],
      columns: { seller_sku: 'Seller SKU', marketplace_sku: 'Myntra SKU' },
      rows: 3,
      unmatched: ['ZZ-9'],
      matches: [
        { key: 'u2', label: 'Hammer', marketplaceSku: 'MP-2', styleId: 'ST-2', change: 'new' },
        { key: 'u1', label: 'Cordless Drill', marketplaceSku: 'MP-1', styleId: null, change: 'same' },
      ],
    }
    const f = routeFetch([
      ['action=report', (_u: string, init?: RequestInit) => ((init?.body as FormData).get('apply') ? res({ saved: 1 }) : res(preview))],
      [BASE, res(payload())],
    ])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'skus.csv')] } })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Myntra SKU report')).toBeInTheDocument()
    expect(within(dialog).getByText('1 new · 0 changed · 1 unchanged · 1 not in your catalogue')).toBeInTheDocument()
    expect(within(dialog).getByText(/Hammer → MP-2 \(style ST-2\)/)).toBeInTheDocument()
    expect(within(dialog).getByText('Not matched: ZZ-9')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Map 1 unit(s)' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Mapped 1 unit(s) from the report.', 'success'))
    const apply = callsTo(f, 'action=report')[1][1]!.body as FormData
    expect(JSON.parse(String(apply.get('columns')))).toEqual(preview.columns)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('toasts when a SKU report cannot be read', async () => {
    routeFetch([
      ['action=report', res({ error: 'Not a SKU report' }, false)],
      [BASE, res(payload())],
    ])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'bad.csv')] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not a SKU report', 'error'))
  })

  it('opens the template dialog, which needs a file before columns can be read', async () => {
    routeFetch([[BASE, res(payload())]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Cordless Drill')
    fireEvent.click(screen.getByLabelText('Select Hammer'))
    fireEvent.click(screen.getByRole('button', { name: 'Fill a listing template' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Fill a Myntra listing template')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Read columns' })).toBeDisabled()
    expect(within(dialog).getByPlaceholderText('e.g. Tshirts')).toHaveValue('Tools')
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists submission batches and pages long lists', async () => {
    const many = Array.from({ length: 61 }, (_, i) => unit({ key: `k${i}`, name: `Unit ${i}`, ourSku: `S${i}`, listing: null }))
    routeFetch([[BASE, res(payload({ units: many, tasks: [{ task_id: 'T-1', status: 'done', row_count: 5, success_count: 4, error_count: 1, submitted_at: '2026-01-02T10:00:00.000Z' }] }))]])
    renderAs(<ListingsMapper channel="myntra" />)
    await screen.findByText('Unit 0')
    expect(screen.getByText('T-1')).toBeInTheDocument()
    expect(screen.queryByText('Unit 60')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more (1 left)' }))
    expect(screen.getByText('Unit 60')).toBeInTheDocument()
  })
})
