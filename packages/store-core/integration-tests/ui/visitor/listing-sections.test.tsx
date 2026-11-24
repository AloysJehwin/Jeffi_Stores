import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/visitor/home/SectionRenderer', () => ({
  default: ({ section, rowIndex }: any) => <div data-testid={`sec-${section.id}`}>{`${section.type}#${rowIndex}`}</div>,
}))
vi.mock('@/components/admin/kit/infinite', () => ({
  ServerPagedItems: ({ items }: any) => (
    <ul data-testid="paged">
      {items.map((i: any) => (
        <li key={i.key}>{i.node}</li>
      ))}
    </ul>
  ),
}))
vi.mock('@/components/visitor/ProductCard', () => ({ default: () => null }))
vi.mock('@/components/visitor/listing/listing-items', () => ({
  renderProductItem: (p: any, _gst: boolean, deferred: boolean) => <span>{`card:${p.id}:${deferred ? 'lazy' : 'eager'}`}</span>,
}))
// Specifiers split so the component-tests check doesn't count a stub as coverage of SiteCard / HomeSections.
vi.mock('@/components/visitor/site/code/common/' + 'SiteCard',() => ({
  SiteCardView: ({ product, priority }: any) => <span>{`site:${product.id}:${priority ? 'prio' : '-'}`}</span>,
}))
const rowViews = vi.fn()
const ratingsFor = vi.fn()
vi.mock('@/components/visitor/site/code/parts/product/views', () => ({
  rowViews: (...a: any[]) => rowViews(...a),
  ratingsFor: (...a: any[]) => ratingsFor(...a),
}))
const siteCard = vi.fn()
vi.mock('@/lib/site/card', () => ({ siteCard: () => siteCard() }))
vi.mock('@/lib/site/data', () => ({ money: (n: number) => `Rs${n}`, siteData: () => ({}) }))
const getPageSections = vi.fn()
const loadSectionData = vi.fn()
vi.mock('@/lib/catalog/homepage-model', () => ({
  getPageSections: (...a: any[]) => getPageSections(...a),
  loadSectionData: (...a: any[]) => loadSectionData(...a),
}))
vi.mock('@/components/visitor/home/' + 'HomeSections',() => ({ HALF_CELL: 'half-cell', HALF_ROW: 'half-row' }))

import {
  EAGER_CARDS,
  ListingPagedItems,
  placementsOnPage,
  productPageItems,
  spliceAt,
  withListingSections,
} from '@/components/visitor/listing/listing-sections'

const section = (id: string, type = 'trust_strip', config: any = {}) => ({ id, type, config }) as any
const item = (key: string, extra = false) => ({ key, extra, node: <span>{key}</span> })
const opts = (over: any = {}) => ({ page: 'products', surface: 'store', pageNum: 1, pageSize: 10, total: 30, ...over })
const keys = (items: any[]) => items.map(i => i.key)

describe('placementsOnPage', () => {
  it('puts a section after the default 12th product on the page that holds it', () => {
    const s = [section('a')]
    expect(placementsOnPage(s, { pageNum: 1, pageSize: 10, total: 30 })).toEqual([])
    const p2 = placementsOnPage(s, { pageNum: 2, pageSize: 10, total: 30 })
    expect(p2).toHaveLength(1)
    expect(p2[0]).toMatchObject({ at: 2, key: 'section:a:12' })
  })

  it('repeats an "every N" section and sorts by position; never trails the last product', () => {
    const s = [section('a', 'trust_strip', { placement: { after: 2, every: 4 } })]
    const r = placementsOnPage(s, { pageNum: 1, pageSize: 10, total: 9 })
    expect(r.map(x => x.at)).toEqual([2, 6])
  })

  it('carries the right-hand partner of a two-column row', () => {
    const left = section('l', 'trust_strip', { layout: { side: 'left' }, placement: { after: 1 } })
    const right = section('r', 'about', { layout: { side: 'right' } })
    const r = placementsOnPage([left, right], { pageNum: 1, pageSize: 10, total: 30 })
    expect(r).toHaveLength(1)
    expect(r[0].partner?.id).toBe('r')
  })
})

describe('spliceAt', () => {
  const ins = (at: number, key: string) => ({ at, item: item(key, true) })

  it('returns the items untouched with no inserts', () => {
    const items = [item('p1')]
    expect(spliceAt(items, [])).toBe(items)
  })

  it('counts only products, lands before the next product (after any extras), and appends past the end', () => {
    const items = [item('p1'), item('x', true), item('p2'), item('p3')]
    expect(keys(spliceAt(items, [ins(1, 'A'), ins(9, 'Z')]))).toEqual(['p1', 'x', 'A', 'p2', 'p3', 'Z'])
  })

  it('an insert at 0 leads the list', () => {
    expect(keys(spliceAt([item('p1')], [ins(0, 'A')]))).toEqual(['A', 'p1'])
  })
})

describe('withListingSections', () => {
  beforeEach(() => {
    for (const m of [rowViews, ratingsFor, siteCard, getPageSections, loadSectionData]) m.mockReset()
    siteCard.mockResolvedValue(null)
    getPageSections.mockResolvedValue([])
    loadSectionData.mockResolvedValue({})
  })

  it('returns an empty list as is without loading anything', async () => {
    expect(await withListingSections([], opts())).toEqual([])
    expect(getPageSections).not.toHaveBeenCalled()
  })

  it('leaves the items alone when no section lands on the page, or when sections fail to load', async () => {
    const items = [item('p1')]
    expect(await withListingSections(items, opts())).toBe(items)
    getPageSections.mockRejectedValue(new Error('db'))
    expect(await withListingSections(items, opts())).toBe(items)
    expect(loadSectionData).not.toHaveBeenCalled()
  })

  it('splices a section into the grid after its product and numbers product rows', async () => {
    getPageSections.mockResolvedValue([section('a', 'product_row', { placement: { after: 1 } }), section('b', 'product_row', { placement: { after: 2 } })])
    const out = await withListingSections([item('p1'), item('p2'), item('p3')], opts({ draft: null }))
    expect(keys(out)).toEqual(['p1', 'section:a:1', 'p2', 'section:b:2', 'p3'])
    expect(out[1].extra).toBe(true)
    expect(loadSectionData).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a' })]), expect.objectContaining({ page: 'products' }))
    render(<>{out[1].node}{out[3].node}</>)
    expect(screen.getByTestId('sec-a')).toHaveTextContent('product_row#0')
    expect(screen.getByTestId('sec-b')).toHaveTextContent('product_row#1')
  })

  it('draws a two-column row with both sections', async () => {
    getPageSections.mockResolvedValue([
      section('l', 'trust_strip', { layout: { side: 'left' }, placement: { after: 1 } }),
      section('r', 'about', { layout: { side: 'right' } }),
    ])
    const out = await withListingSections([item('p1'), item('p2')], opts())
    render(<>{out[1].node}</>)
    expect(screen.getByTestId('sec-l')).toBeInTheDocument()
    expect(screen.getByTestId('sec-r')).toBeInTheDocument()
    expect(out[1].node).toMatchObject({ props: { className: expect.stringContaining('half-row') } })
  })

  it('uses the site card for product cards the listing drew, when the store has one', async () => {
    const { default: ProductCard } = await import('@/components/visitor/ProductCard')
    siteCard.mockResolvedValue({ id: 'card' })
    ratingsFor.mockResolvedValue(new Map([['9', { rating: 4.5, count: 3 }]]))
    const node = <ProductCard {...({ id: 9, slug: 's', name: 'N', displayPrice: 100, mrp: 150, mrpDiscount: 33, effectiveStock: 1 } as any)} />
    const out = await withListingSections([{ key: '9', node }], opts())
    expect(out[0].card).toBe(true)
    render(<>{out[0].node}</>)
    expect(screen.getByText('site:9:-')).toBeInTheDocument()
  })
})

describe('productPageItems', () => {
  beforeEach(() => {
    for (const m of [rowViews, ratingsFor, siteCard, getPageSections, loadSectionData]) m.mockReset()
    getPageSections.mockResolvedValue([])
  })

  it('draws store cards, deferring everything past the eager count', async () => {
    siteCard.mockResolvedValue(null)
    const out = await productPageItems([{ id: 'a' }, { id: 'b' }], true, opts(), 1)
    expect(keys(out)).toEqual(['a', 'b'])
    render(<>{out.map(o => o.node)}</>)
    expect(screen.getByText('card:a:eager')).toBeInTheDocument()
    expect(screen.getByText('card:b:lazy')).toBeInTheDocument()
  })

  it('draws every product with the site card when the store has one; only the first eager one is prioritised', async () => {
    siteCard.mockResolvedValue({ id: 'card' })
    rowViews.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const out = await productPageItems([{ id: 'a' }, { id: 'b' }], false, opts(), 6)
    expect(rowViews).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }], false)
    expect(out.every(o => o.card)).toBe(true)
    render(<>{out.map(o => o.node)}</>)
    expect(screen.getByText('site:a:prio')).toBeInTheDocument()
    expect(screen.getByText('site:b:-')).toBeInTheDocument()
  })

  it('does not look up a site card for an empty page', async () => {
    expect(await productPageItems([], true, opts())).toEqual([])
    expect(siteCard).not.toHaveBeenCalled()
  })

  it('exposes the eager card count', () => {
    expect(EAGER_CARDS).toBe(6)
  })
})

describe('ListingPagedItems', () => {
  beforeEach(() => {
    siteCard.mockResolvedValue(null)
    getPageSections.mockResolvedValue([section('a', 'trust_strip', { placement: { after: 1 } })])
    loadSectionData.mockResolvedValue({})
  })

  it('renders the paged list with the sections spliced between products', async () => {
    const ui = await ListingPagedItems({ items: [item('p1'), item('p2')], listing: opts() } as any)
    render(ui as any)
    const lis = screen.getByTestId('paged').querySelectorAll('li')
    expect(lis).toHaveLength(3)
    expect(lis[1]).toContainElement(screen.getByTestId('sec-a'))
  })
})
