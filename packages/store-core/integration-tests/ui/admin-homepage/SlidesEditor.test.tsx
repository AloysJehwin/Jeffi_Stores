import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import SlidesEditor from '@/components/admin/homepage/editors/SlidesEditor'
import { renderEditor, input, commit, choose, combo, P1, P2, PRODUCTS } from './editor-kit'

// SlidesEditor: offer / category / product / custom slides. Offers and categories load from the API (fetch
// stubbed); the media picker and AI copy button are stubbed.
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ identity: { name: 'Jeffi' } }) }))
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label, allowVideo, onChange }: any) => (
    <button type="button" data-testid={`media-${label}`} onClick={() => onChange({ image: '/new.jpg', video: allowVideo ? '/new.mp4' : null })}>
      pick media
    </button>
  ),
}))
vi.mock('@/components/admin/ai/AiCopyButton', () => ({
  default: ({ fields, onFill }: any) => (
    <button type="button" onClick={() => onFill(Object.fromEntries(fields.map((f: any) => [f.name, `AI ${f.name}`])))}>
      write with ai
    </button>
  ),
}))

const OFFERS = [
  { id: P1, title: 'Winter Sale', is_active: true, starts_at: null, ends_at: null, product_count: 3 },
  { id: P2, title: 'Old Sale', is_active: false, starts_at: null, ends_at: null, product_count: 1 },
]
const CATS = [
  { id: 'cat-a', name: 'Tools', parent_category_id: null },
  { id: 'cat-b', name: 'Drills', parent_category_id: 'cat-a' },
]

function stubApi(opts: { fail?: boolean } = {}) {
  const fn = vi.fn(async (url: string) => {
    if (opts.fail && !url.includes('/homepage/products')) throw new Error('down')
    if (url.includes('product-offers')) return { ok: true, json: async () => ({ offers: OFFERS }) }
    if (url.includes('/api/categories')) return { ok: true, json: async () => ({ categories: CATS }) }
    return { ok: true, json: async () => ({ products: PRODUCTS }) }
  })
  vi.stubGlobal('fetch', fn as any)
  return fn
}

const offerSlide = (over: Record<string, unknown> = {}) => ({ id: 's1', kind: 'offer', offerId: P1, ...over })
const customSlide = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'custom',
  image: '/hero.jpg',
  title: 'Built to last',
  ...over,
})

describe('SlidesEditor', () => {
  beforeEach(() => {
    stubApi()
  })

  it('asks for a first slide and shows the layout defaults', () => {
    renderEditor(SlidesEditor, 'slides')
    expect(screen.getByText(/Add at least one slide/)).toBeInTheDocument()
    expect(combo('Layout')).toHaveTextContent('Cards')
    expect(combo('Slide shape')).toHaveTextContent('Portrait 4:5')
    expect(screen.queryByText('Seconds per slide')).toBeNull()
  })

  it('saves layout and shape', () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides')
    choose('Layout', 'Banner')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { layout: 'banner' } })
    choose('Slide shape', 'Wide 16:9')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { aspect: '16:9' } })
  })

  it('turns autoplay on, which reveals the interval capped at 20 seconds', () => {
    const { onSave, unmount } = renderEditor(SlidesEditor, 'slides')
    fireEvent.click(screen.getByRole('switch'))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { autoplay: true } })
    unmount()
    const r = renderEditor(SlidesEditor, 'slides', { config: { autoplay: true } })
    commit(input('Seconds per slide'), '90')
    expect(r.onSave).toHaveBeenLastCalledWith('sec-1', { config: { autoplay: true, intervalSeconds: 20 } })
  })

  it('shows the loading placeholder, then the chosen offer once offers arrive', async () => {
    renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide()] } })
    expect(combo('Offer')).toHaveTextContent('Loading offers…')
    await waitFor(() => expect(combo('Offer')).toHaveTextContent('Winter Sale'))
    expect(screen.queryByText(/Add at least one slide/)).toBeNull()
  })

  it('re-points an offer slide at another offer, keeping its id', async () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide()] } })
    await waitFor(() => expect(combo('Offer')).toHaveTextContent('Winter Sale'))
    fireEvent.click(combo('Offer'))
    expect(screen.getByText(/hidden/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Old Sale/ }))
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: { items: [{ id: 's1', kind: 'offer', offerId: P2 }] },
    })
  })

  it('says so when the offers cannot be loaded', async () => {
    stubApi({ fail: true })
    renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide()] } })
    await waitFor(() => expect(combo('Offer')).toHaveTextContent('Could not load offers'))
  })

  it('switches a slide to a category slide, which loads the category tree', async () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide()] } })
    choose('Shows', 'Category')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: { items: [{ id: 's1', kind: 'category', categoryId: '' }] },
    })
  })

  it('lists categories with sub-categories indented for a category slide', async () => {
    renderEditor(SlidesEditor, 'slides', { config: { items: [{ id: 's1', kind: 'category', categoryId: P1 }] } })
    await waitFor(() => expect(combo('Category')).toHaveTextContent('Choose a category'))
    fireEvent.click(combo('Category'))
    expect(screen.getByRole('option', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Drills' })).toBeInTheDocument()
  })

  it('shows a product picker for a product slide and saves the picked product', async () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [{ id: 's1', kind: 'product', productId: P1 }] } })
    expect(await screen.findByText('Cordless Drill')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cordless Drill' }))
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { items: [{ id: 's1', kind: 'product', productId: '' }] } })
  })

  it('edits a custom slide: copy, image and AI fill', () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [customSlide()] } })
    expect(input('Title')).toHaveValue('Built to last')
    commit(input('Eyebrow', 1), 'New')
    expect(onSave.mock.calls.at(-1)![1].config.items[0]).toMatchObject({ id: 'c1', kind: 'custom', eyebrow: 'New', title: 'Built to last' })
    fireEvent.click(screen.getByTestId('media-Image'))
    expect(onSave.mock.calls.at(-1)![1].config.items[0]).toMatchObject({ image: '/new.jpg', video: '/new.mp4' })
    fireEvent.click(screen.getByRole('button', { name: 'write with ai' }))
    expect(onSave.mock.calls.at(-1)![1].config.items[0]).toMatchObject({ eyebrow: 'AI eyebrow', title: 'AI title', sub: 'AI sub', ctaLabel: 'AI ctaLabel' })
  })

  it('saves the motion style of a custom slide', () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [customSlide()] } })
    choose('Motion', 'Slow zoom')
    expect(onSave.mock.calls.at(-1)![1].config.items[0].motion).toBe('kenburns')
  })

  it('adds a blank offer slide with a minted id', () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides')
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    expect(onSave.mock.calls[0][1].config.items).toEqual([{ id: expect.any(String), kind: 'offer', offerId: '' }])
  })

  it('notes slides that are not shown yet', () => {
    renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide({ offerId: '' }), customSlide()] } })
    expect(screen.getByText(/One slide is not shown yet/)).toBeInTheDocument()
  })

  it('flags custom slides with unsafe links', () => {
    renderEditor(SlidesEditor, 'slides', { config: { items: [customSlide({ url: 'javascript:1' })] } })
    expect(screen.getByText(/One slide has a link that will be ignored/)).toBeInTheDocument()
  })

  it('reorders and removes slides', () => {
    const { onSave } = renderEditor(SlidesEditor, 'slides', { config: { items: [offerSlide(), customSlide()] } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Down' })[0])
    expect(onSave.mock.calls.at(-1)![1].config.items.map((i: any) => i.id)).toEqual(['c1', 's1'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(onSave.mock.calls.at(-1)![1].config.items.map((i: any) => i.id)).toEqual(['c1'])
  })

  it('locks every control without write access', () => {
    renderEditor(SlidesEditor, 'slides', { config: { items: [customSlide()] } }, { canWrite: false })
    expect(combo('Layout')).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
    expect(input('Title')).toBeDisabled()
  })
})
