import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
const showConfirm = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast, showConfirm }), useToastOptional: () => ({ showToast }) }))
let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  useCanWrite: () => canWrite,
  RequireWrite: ({ children }: any) => <>{children}</>,
  RequireAi: ({ children }: any) => <>{children}</>,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder === 'Any' ? 'filter' : 'select'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/AdminImage', () => ({ default: ({ src }: any) => <img alt="thumb" src={src} /> }))
vi.mock('@/components/admin/AIEnrichButton', () => ({ default: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label, onChange }: any) => (
    <button type="button" onClick={() => onChange({ image: 'https://cdn/x.png', blurhash: 'bh', video: null })}>{`media ${label}`}</button>
  ),
}))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Halo' } }) }))
const notify = vi.fn()
vi.mock('@/components/admin/homepage/draft-events', () => ({ notifyHomepageDraftChanged: () => notify() }))
let readOnly = false
let lockedResult = false
vi.mock('@/components/admin/homepage/HomepageLock', () => ({
  useHomepageLock: () => ({ headers: () => ({ 'x-lock': '1' }), locked: async () => lockedResult, readOnly }),
}))

import HeroSlideManager, { type HeroSlideRow } from '@/components/admin/HeroSlideManager'

const slide = (id: string, o: Partial<HeroSlideRow> = {}): HeroSlideRow => ({
  id, title: `Slide ${id}`, subtitle: 'Sub', badge_text: 'New', badge_color: 'bg-red-500', image_url: '/a.png', image_url_mobile: null,
  cta_label: null, cta_url: null, filter_category: null, filter_brand: null, filter_grade: null, filter_material: null,
  filter_min_price: null, filter_max_price: null, filter_in_stock: false, filter_on_sale: false, display_order: 0, is_active: true, ...o,
})
const opts = { categoryOptions: [{ value: 'c1', label: 'Fasteners' }], brandOptions: [], gradeOptions: [], materialOptions: [] }
const mount = (slides: HeroSlideRow[], p: any = {}) => render(<HeroSlideManager initialSlides={slides} {...opts} {...p} />)

const fetchMock = vi.fn()
beforeEach(() => {
  showToast.mockReset()
  showConfirm.mockReset()
  notify.mockReset()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  vi.stubGlobal('fetch', fetchMock)
  canWrite = true
  readOnly = false
  lockedResult = false
})
afterEach(() => vi.unstubAllGlobals())

const expand = () => fireEvent.click(screen.getAllByRole('button').find(b => b.querySelector('svg path[d="M6 8l4 4 4-4"]'))!)

describe('HeroSlideManager list', () => {
  it('shows an empty message and the add button', () => {
    mount([])
    expect(screen.getByText(/No hero slides yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add hero slide' })).toBeEnabled()
  })

  it('lists the slides of the chosen audience with their link and hidden badge', () => {
    mount([slide('1', { filter_category: 'c1' }), slide('2', { is_active: false, cta_url: '/sale' }), slide('3', { audience: 'business' })])
    expect(screen.getByText('Slide 1')).toBeInTheDocument()
    expect(screen.getByText('Slide 2')).toBeInTheDocument()
    expect(screen.queryByText('Slide 3')).toBeNull()
    expect(screen.getByText('/products?category=c1')).toBeInTheDocument()
    expect(screen.getByText('/sale')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('shows the business slides for the business audience', () => {
    mount([slide('1'), slide('3', { audience: 'business' })], { audience: 'business' })
    expect(screen.queryByText('Slide 1')).toBeNull()
    expect(screen.getByText('Slide 3')).toBeInTheDocument()
  })

  it('adds a slide through the API and toasts', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ slide: slide('9', { title: 'New slide' }) }) })
    mount([], { surface: 'app' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add hero slide' }))
    expect(await screen.findByText('New slide')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/hero-slides')
    expect(JSON.parse(init.body)).toMatchObject({ title: 'New slide', surface: 'app', audience: 'store' })
    expect(init.headers['x-lock']).toBe('1')
    expect(showToast).toHaveBeenCalledWith('Slide added to draft', 'success')
    expect(notify).toHaveBeenCalled()
  })

  it('toasts the server error when adding fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Limit reached' }) })
    mount([])
    fireEvent.click(screen.getByRole('button', { name: '+ Add hero slide' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Limit reached', 'error'))
  })

  it('reorders slides and persists the new order', async () => {
    mount([slide('1'), slide('2')])
    const downs = screen.getAllByTitle('Move down')
    expect(screen.getAllByTitle('Move up')[0]).toBeDisabled()
    fireEvent.click(downs[0])
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/hero-slides')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ order: ['2', '1'] })
    const titles = screen.getAllByText(/^Slide \d$/).map(t => t.textContent)
    expect(titles).toEqual(['Slide 2', 'Slide 1'])
  })

  it('reverts the order when the homepage is locked by someone else', async () => {
    lockedResult = true
    fetchMock.mockResolvedValue({ ok: false })
    mount([slide('1'), slide('2')])
    fireEvent.click(screen.getAllByTitle('Move down')[0])
    await waitFor(() => expect(screen.getAllByText(/^Slide \d$/).map(t => t.textContent)).toEqual(['Slide 1', 'Slide 2']))
  })

  it('delete asks to confirm and removes the slide on approval', async () => {
    mount([slide('1'), slide('2')])
    fireEvent.click(screen.getAllByRole('button').filter(b => b.querySelector('svg path[d="M6 8l4 4 4-4"]'))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete slide' }))
    const cfg = showConfirm.mock.calls[0][0]
    expect(cfg).toMatchObject({ title: 'Delete slide?', type: 'danger', confirmText: 'Delete' })
    await cfg.onConfirm()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/hero-slides/1', expect.objectContaining({ method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('Slide 1')).toBeNull())
    expect(showToast).toHaveBeenCalledWith('Slide removed from draft', 'success')
  })

  it('a failed delete keeps the slide and toasts', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    mount([slide('1')])
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Delete slide' }))
    await showConfirm.mock.calls[0][0].onConfirm()
    expect(showToast).toHaveBeenCalledWith('Failed to delete', 'error')
    expect(screen.getAllByText('Slide 1').length).toBeGreaterThan(0)
  })
})

describe('HeroSlideManager slide editing', () => {
  it('the active switch patches isActive and marks the slide hidden', async () => {
    mount([slide('1')])
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/hero-slides/1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ isActive: false })
    await waitFor(() => expect(notify).toHaveBeenCalled())
  })

  it('a failed save toasts, unless the lock handled it', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    mount([slide('1')])
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save', 'error'))
    showToast.mockClear()
    lockedResult = true
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(showToast).not.toHaveBeenCalled()
  })

  it('expands to edit the title, saving on blur', async () => {
    mount([slide('1')])
    expand()
    const title = screen.getAllByRole('textbox').find(i => (i as HTMLInputElement).value === 'Slide 1')!
    fireEvent.change(title, { target: { value: 'Summer sale' } })
    expect(screen.getAllByText('Summer sale').length).toBeGreaterThan(0)
    fireEvent.blur(title)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Summer sale' })
  })

  it('picking a badge colour patches it', async () => {
    mount([slide('1')])
    expand()
    fireEvent.click(screen.getByTitle('Blue'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ badgeColor: 'bg-blue-600' })
  })

  it('a filter changes the generated link and is saved', async () => {
    mount([slide('1')])
    expand()
    fireEvent.change(screen.getAllByLabelText('filter')[0], { target: { value: 'c1' } })
    expect(screen.getByText('/products?category=c1', { selector: 'span.font-mono' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ filterCategory: 'c1' })
  })

  it('stock and sale checkboxes add query flags', () => {
    mount([slide('1')])
    expand()
    fireEvent.click(screen.getByLabelText('In stock only'))
    fireEvent.click(screen.getByLabelText('On sale'))
    expect(screen.getByText('/products?inStock=1&onSale=1', { selector: 'span.font-mono' })).toBeInTheDocument()
  })

  it('a manual URL overrides the filters', async () => {
    mount([slide('1', { filter_category: 'c1' })])
    expand()
    const url = screen.getByPlaceholderText('/categories/fasteners or https://…')
    fireEvent.change(url, { target: { value: '/promo' } })
    fireEvent.blur(url)
    await waitFor(() => expect(screen.getByText('/promo', { selector: 'span.font-mono' })).toBeInTheDocument())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ctaUrl: '/promo' })
  })

  it('price fields save numbers on blur', async () => {
    mount([slide('1')])
    expand()
    const min = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(min, { target: { value: '250' } })
    fireEvent.blur(min)
    await waitFor(() => expect(screen.getByText('/products?minPrice=250', { selector: 'span.font-mono' })).toBeInTheDocument())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ filterMinPrice: 250 })
  })

  it('a media pick patches the desktop image fields', async () => {
    mount([slide('1')])
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'media Banner — desktop' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ imageUrl: 'https://cdn/x.png', blurhash: 'bh', videoUrl: null })
  })
})

describe('HeroSlideManager AI generation', () => {
  it('needs a scenario, then writes copy and creates the image', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/ai-fill-form') return { ok: true, json: () => Promise.resolve({ fields: { title: ' Fasteners ', subtitle: 'Built tough.', badge_text: 'New' } }) }
      if (url.endsWith('/generate-image')) return { ok: true, json: () => Promise.resolve({ url: '/gen.png', blurhash: 'x' }) }
      return { ok: true, json: () => Promise.resolve({}) }
    })
    mount([slide('1')])
    expand()
    const go = screen.getByRole('button', { name: 'Generate everything' })
    expect(go).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/Fasteners range/), { target: { value: 'bolts and nuts' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Image generated and saved to draft', 'success'))
    const fill = fetchMock.mock.calls.find(c => c[0] === '/api/admin/ai-fill-form')!
    expect(JSON.parse(fill[1].body).scenario).toContain('Halo')
    const save = fetchMock.mock.calls.find(c => c[0] === '/api/admin/hero-slides/1' && c[1].method === 'PATCH')!
    expect(JSON.parse(save[1].body)).toEqual({ title: 'Fasteners', subtitle: 'Built tough.', badgeText: 'New' })
    expect(screen.getByAltText('thumb')).toHaveAttribute('src', '/gen.png')
  })

  it('reports a text failure and still tries the image', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/admin/ai-fill-form' ? { ok: false, json: () => Promise.resolve({ error: 'AI is down' }) } : { ok: false, json: () => Promise.resolve({ error: 'No credits' }) }
    )
    mount([slide('1')])
    expand()
    fireEvent.change(screen.getByPlaceholderText(/Fasteners range/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate everything' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('AI is down', 'error'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No credits', 'error'))
  })
})

describe('HeroSlideManager read-only', () => {
  it('disables editing while someone else holds the homepage draft', () => {
    readOnly = true
    mount([slide('1')])
    expect(screen.getByRole('button', { name: '+ Add hero slide' })).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()
    expand()
    expect(screen.getByLabelText('In stock only')).toBeDisabled()
  })

  it('without write access the controls are disabled', () => {
    canWrite = false
    mount([slide('1')])
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Add hero slide' })).toBeDisabled()
  })
})
