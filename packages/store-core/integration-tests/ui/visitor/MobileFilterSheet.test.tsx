import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const push = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => params }))

import MobileFilterSheet from '@/components/visitor/MobileFilterSheet'
import { ListingViewContext } from '@/components/visitor/listing/listing-view'

const cats = [
  { id: 'c1', name: 'Audio', parent_category_id: null },
  { id: 'c2', name: 'Speakers', parent_category_id: 'c1' },
  { id: 'c3', name: 'Cables', parent_category_id: null },
]
const brands = [{ id: 'b1', name: 'Halo' }, { id: 'b2', name: 'Zed' }]
const facets = (over: Record<string, any> = {}) => ({
  brands: [], colors: [{ value: 'Red', hex: '#f00', count: 2 }], grades: [{ value: 'A', count: 3 }], materials: [], finishes: [], compliances: [], origins: [],
  inStockCount: 10, onSaleCount: 4, priceMin: 1, priceMax: 9999, hasRatings: true, variantTypes: [{ value: 'size', count: 2 }], variantValues: [{ value: 'large', count: 1 }],
  specFacets: [{ key: 'wattage', values: [{ value: '50W', count: 1 }] }], ...over,
})
const sheet = (props: Record<string, any> = {}) => render(<MobileFilterSheet categories={cats} brands={brands} facets={facets()} {...props} />)
const open = (name = 'Filters') => fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${name}`) })[0])
const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }))
const url = () => String(push.mock.calls.at(-1)![0])
const qs = () => new URLSearchParams(url().split('?')[1] ?? '')

describe('MobileFilterSheet', () => {
  beforeEach(() => {
    push.mockReset()
    params = new URLSearchParams()
    document.body.style.overflow = ''
  })

  it('renders Filters and Sort triggers (no badge by default) and no dialog until opened', () => {
    sheet()
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the count of active filters on the trigger', () => {
    params = new URLSearchParams('brand=b1&inStock=1&minPrice=5&sort=price')
    sheet()
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('4')
  })

  it('opens as a modal on the Filters tab, locks scroll, and closes with Escape, the X and the backdrop', () => {
    const { baseElement } = sheet()
    open()
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAttribute('aria-modal', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    open()
    fireEvent.click(baseElement.querySelector('.bg-black\\/50')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the Sort trigger opens the Sort tab', () => {
    sheet()
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(screen.getByRole('dialog', { name: 'Sort by' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Price: low to high' })).toBeInTheDocument()
  })

  it('picks a sort and applies sort + dir', () => {
    sheet()
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByRole('button', { name: 'Price: high to low' }))
    apply()
    expect(qs().get('sort')).toBe('price')
    expect(qs().get('dir')).toBe('desc')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an untouched sort keeps the URL sort (e.g. group-by-category) while other filters apply', () => {
    params = new URLSearchParams('sort=category&search=amp')
    sheet()
    open()
    fireEvent.click(screen.getByRole('button', { name: /In stock only|In Stock/i }))
    apply()
    expect(qs().get('sort')).toBe('category')
    expect(qs().get('inStock')).toBe('1')
    expect(qs().get('search')).toBe('amp')
  })

  it('applies price presets and typed bounds', () => {
    sheet()
    open()
    fireEvent.click(screen.getByRole('button', { name: '₹500–₹2k' }))
    expect(screen.getByPlaceholderText('Min ₹')).toHaveValue(500)
    fireEvent.change(screen.getByPlaceholderText('Max ₹'), { target: { value: '1500' } })
    apply()
    expect(qs().get('minPrice')).toBe('500')
    expect(qs().get('maxPrice')).toBe('1500')
  })

  it('toggles availability, sale, offers and rating', () => {
    sheet({ offers: [{ slug: 'diwali', title: 'Diwali Sale' }] })
    open()
    const dlg = within(screen.getByRole('dialog'))
    fireEvent.click(dlg.getByRole('button', { name: /On Sale/ }))
    fireEvent.click(dlg.getByRole('button', { name: 'Diwali Sale' }))
    fireEvent.click(dlg.getByRole('button', { name: /★★★★☆ & above/ }))
    apply()
    expect(qs().get('onSale')).toBe('1')
    expect(qs().get('offer')).toBe('diwali')
    expect(qs().get('minRating')).toBe('4')
  })

  it('selecting a category and brand applies both; "All" resets them', () => {
    sheet()
    open()
    const dlg = within(screen.getByRole('dialog'))
    fireEvent.click(dlg.getByRole('button', { name: 'Cables' }))
    fireEvent.click(dlg.getByRole('button', { name: 'Halo' }))
    fireEvent.click(dlg.getByRole('button', { name: 'Zed' }))
    apply()
    expect(qs().get('category')).toBe('c3')
    expect(qs().get('brand')).toBe('b1,b2')
  })

  it('"All Brands" clears the brands picked from the URL', () => {
    params = new URLSearchParams('brand=b1')
    sheet()
    open()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'All Brands' }))
    apply()
    expect(qs().has('brand')).toBe(false)
  })

  it('subcategories expand under their parent and can be selected', () => {
    sheet()
    open()
    const dlg = within(screen.getByRole('dialog'))
    expect(dlg.queryByRole('button', { name: 'Speakers' })).not.toBeInTheDocument()
    fireEvent.click(dlg.getByRole('button', { name: 'Expand Audio' }))
    fireEvent.click(dlg.getByRole('button', { name: 'Speakers' }))
    apply()
    expect(qs().get('category')).toBe('c2')
  })

  it('facet sections: colours, grades with counts, variant type/value and spec pairs', () => {
    sheet()
    open()
    const dlg = within(screen.getByRole('dialog'))
    fireEvent.click(dlg.getByRole('button', { name: 'Red' }))
    fireEvent.click(dlg.getByRole('button', { name: /^A\s*\(3\)/ }))
    fireEvent.click(dlg.getByRole('button', { name: /Size/i }))
    fireEvent.click(dlg.getByRole('button', { name: /Large/i }))
    fireEvent.click(dlg.getByRole('button', { name: /50W/ }))
    apply()
    expect(qs().get('color')).toBe('Red')
    expect(qs().get('grade')).toBe('A')
    expect(qs().get('variantType')).toBe('size')
    expect(qs().get('variantValue')).toBe('large')
    expect(qs().get('specKey')).toBe('wattage')
    expect(qs().get('specValue')).toBe('50W')
  })

  it('long facet lists show 6 with a "more" expander', () => {
    const grades = Array.from({ length: 8 }, (_, i) => ({ value: `G${i}`, count: i }))
    sheet({ facets: facets({ grades }) })
    open()
    expect(screen.queryByText('G7')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(screen.getByText('G7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('G7')).not.toBeInTheDocument()
  })

  it('Clear all appears once something is pending and wipes the draft', () => {
    sheet()
    open()
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Halo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    apply()
    expect(qs().has('brand')).toBe(false)
  })

  it('starts the draft from the current URL each time it opens', () => {
    params = new URLSearchParams('brand=b2&minPrice=700')
    sheet()
    open()
    expect(screen.getByPlaceholderText('Min ₹')).toHaveValue(700)
    fireEvent.change(screen.getByPlaceholderText('Min ₹'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    open()
    expect(screen.getByPlaceholderText('Min ₹')).toHaveValue(700)
  })

  it('uses the base path for navigation', () => {
    sheet({ basePath: '/categories/audio' })
    open()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Halo' }))
    apply()
    expect(url().startsWith('/categories/audio?')).toBe(true)
  })

  it('navigates to the bare path when nothing is selected', () => {
    sheet()
    open()
    apply()
    expect(url()).toBe('/products')
  })

  it('works without facets (empty defaults)', () => {
    render(<MobileFilterSheet categories={[]} brands={[]} />)
    open()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Red/ })).not.toBeInTheDocument()
  })

  it('in the table view the Sort trigger and tab are hidden', () => {
    render(
      <ListingViewContext.Provider value="table">
        <MobileFilterSheet categories={cats} brands={brands} facets={facets()} />
      </ListingViewContext.Provider>
    )
    expect(screen.getByRole('button', { name: 'Sort', hidden: true }).className).toContain('hidden')
  })

  it('"always" drops the lg:hidden class so it shows at every width', () => {
    const a = sheet()
    expect(screen.getByRole('button', { name: 'Filters' }).className).toContain('lg:hidden')
    a.unmount()
    sheet({ always: true })
    expect(screen.getByRole('button', { name: 'Filters' }).className).not.toContain('lg:hidden')
  })
})
