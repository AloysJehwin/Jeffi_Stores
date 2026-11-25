import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => params }))

import FilterSidebar from '@/components/visitor/FilterSidebar'

const facets = (over: Record<string, any> = {}) => ({
  brands: [{ id: 'b1', name: 'Halo', count: 4 }, { id: 'b2', name: 'Zed', count: 2 }],
  colors: [{ value: 'Red', hex: '#ff0000', count: 3 }, { value: 'Blue', hex: null, count: 1 }],
  grades: [], materials: [], finishes: [], compliances: [], origins: [],
  inStockCount: 12, onSaleCount: 5, priceMin: 99, priceMax: 12500, variantTypes: [], variantValues: [], specFacets: [],
  ...over,
})
const cats = [
  { id: 'c1', name: 'Audio', slug: 'audio', parent_category_id: null },
  { id: 'c2', name: 'Speakers', slug: 'speakers', parent_category_id: 'c1' },
  { id: 'c3', name: 'Cables', slug: 'cables', parent_category_id: null },
]
const lastUrl = () => String(push.mock.calls.at(-1)![0])
const qs = () => new URLSearchParams(lastUrl().split('?')[1] ?? '')

describe('FilterSidebar', () => {
  beforeEach(() => {
    push.mockReset()
    params = new URLSearchParams()
    localStorage.clear()
  })

  it('shows the price bounds, availability counts, the on-sale chip and no Clear all by default', () => {
    render(<FilterSidebar facets={facets()} />)
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
    expect(screen.getByText('₹99 – ₹12,500')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /On Sale/ })).toHaveTextContent('(5)')
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('collapses and expands a section, remembering it in localStorage', () => {
    render(<FilterSidebar facets={facets()} />)
    expect(screen.getByText('In Stock')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Availability/ }))
    expect(screen.queryByText('In Stock')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('filter_sidebar_sections_v2')!).Availability).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Availability/ }))
    expect(screen.getByText('In Stock')).toBeInTheDocument()
  })

  it('restores saved section state', () => {
    localStorage.setItem('filter_sidebar_sections_v2', JSON.stringify({ Brand: false }))
    render(<FilterSidebar facets={facets()} />)
    expect(screen.queryByText('Halo')).not.toBeInTheDocument()
  })

  it('price inputs apply on Go and on Enter, trimming blanks, and reset the page', () => {
    params = new URLSearchParams('page=4&search=amp&sort=price')
    render(<FilterSidebar facets={facets()} basePath="/brands/halo" />)
    fireEvent.change(screen.getByPlaceholderText('Min'), { target: { value: ' 100 ' } })
    fireEvent.change(screen.getByPlaceholderText('Max'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(lastUrl().startsWith('/brands/halo?')).toBe(true)
    expect(qs().get('minPrice')).toBe('100')
    expect(qs().has('maxPrice')).toBe(false)
    expect(qs().get('search')).toBe('amp')
    expect(qs().has('page')).toBe(false)
    fireEvent.change(screen.getByPlaceholderText('Max'), { target: { value: '500' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Max'), { key: 'Enter' })
    expect(qs().get('maxPrice')).toBe('500')
  })

  it('price presets set the range and highlight when active', () => {
    render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: '₹500 – ₹2,000' }))
    expect(qs().get('minPrice')).toBe('500')
    expect(qs().get('maxPrice')).toBe('2000')
    expect(screen.getByPlaceholderText('Min')).toHaveValue(500)
    fireEvent.click(screen.getByRole('button', { name: 'Under ₹500' }))
    expect(qs().has('minPrice')).toBe(false)
    expect(qs().get('maxPrice')).toBe('500')
  })

  it('an active preset is highlighted', () => {
    params = new URLSearchParams('minPrice=10000')
    render(<FilterSidebar facets={facets()} />)
    expect(screen.getByRole('button', { name: '₹10,000+' }).className).toContain('border-accent-500')
    expect(screen.getByRole('button', { name: 'Under ₹500' }).className).not.toContain('border-accent-500')
  })

  it('In Stock toggles inStock=1, and the "include out of stock" row reflects the inverse', () => {
    render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: /^In Stock/ }))
    expect(qs().get('inStock')).toBe('1')
  })

  it('with inStock active it removes the param again', () => {
    params = new URLSearchParams('inStock=1')
    render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: /Include Out of Stock/ }))
    expect(qs().has('inStock')).toBe(false)
  })

  it('On Sale and named offers toggle their params', () => {
    render(<FilterSidebar facets={facets()} offers={[{ slug: 'diwali', title: 'Diwali Sale' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /On Sale/ }))
    expect(qs().get('onSale')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: /Diwali Sale/ }))
    expect(qs().get('offer')).toBe('diwali')
  })

  it('selecting a brand adds its id; selecting another appends; deselecting removes', () => {
    const a = render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: /Halo/ }))
    expect(qs().get('brand')).toBe('b1')
    a.unmount()
    params = new URLSearchParams('brand=b1')
    render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: /Zed/ }))
    expect(qs().get('brand')).toBe('b1,b2')
    fireEvent.click(screen.getByRole('button', { name: /Halo/ }))
    expect(qs().has('brand')).toBe(false)
  })

  it('long brand lists show 6 and expand with "more"', () => {
    const brands = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, name: `Brand ${i}`, count: i }))
    render(<FilterSidebar facets={facets({ brands })} />)
    expect(screen.queryByText('Brand 8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+3 more' }))
    expect(screen.getByText('Brand 8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Brand 8')).not.toBeInTheDocument()
  })

  it('colours toggle by value and show swatches', () => {
    const { container } = render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Red' }))
    expect(qs().get('color')).toBe('Red')
    expect(container.querySelector('[style*="rgb(255, 0, 0)"], [style*="#ff0000"]')).not.toBeNull()
  })

  it('categories: parents listed, children only once the parent is active, All Categories clears', () => {
    render(<FilterSidebar facets={facets()} categories={cats} />)
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speakers' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(qs().get('category')).toBe('c1')
  })

  it('an active parent reveals its subcategories, which can be picked, and All Categories clears', () => {
    params = new URLSearchParams('category=audio')
    render(<FilterSidebar facets={facets()} categories={cats} />)
    fireEvent.click(screen.getByRole('button', { name: 'Speakers' }))
    expect(qs().get('category')).toBe('audio,c2')
    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }))
    expect(qs().has('category')).toBe(false)
  })

  it('deselecting an active category removes it', () => {
    params = new URLSearchParams('category=c1')
    render(<FilterSidebar facets={facets()} categories={cats} />)
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(qs().has('category')).toBe(false)
  })

  it('shows Clear all when a filter is active and clears everything but the preserved params', () => {
    params = new URLSearchParams('brand=b1&color=Red&minPrice=10&search=amp&sort=price&dir=asc&page=2')
    render(<FilterSidebar facets={facets()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect([...qs().keys()].sort()).toEqual(['dir', 'search', 'sort'])
    expect(screen.getByPlaceholderText('Min')).toHaveValue(null)
  })

  it('multi-select facets (grade etc.) list values with counts and cap at 6', () => {
    const grades = Array.from({ length: 8 }, (_, i) => ({ value: `G${i}`, count: i + 1 }))
    render(<FilterSidebar facets={facets({ grades, materials: [{ value: 'Steel', count: 2 }] })} />)
    // not open by default
    expect(screen.queryByText('G0')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Grade/ }))
    expect(screen.getByText('G5')).toBeInTheDocument()
    expect(screen.queryByText('G6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getByText('G7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /G1/ }))
    expect(qs().get('grade')).toBe('G1')
  })

  it('variant dimensions: pick a type, then its values; switching type clears the value', () => {
    params = new URLSearchParams('variantType=size&variantValue=large')
    render(
      <FilterSidebar
        facets={facets({ variantTypes: [{ value: 'size', count: 3 }, { value: 'colour', count: 2 }], variantValues: [{ value: 'large', count: 1 }, { value: 'small', count: 2 }] })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Variant Dimensions/ }))
    fireEvent.click(screen.getByRole('button', { name: /Colour/i }))
    expect(qs().get('variantType')).toBe('colour')
    expect(qs().has('variantValue')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Small/i }))
    expect(qs().get('variantValue')).toBe('small')
  })

  it('spec facets pick a key/value pair and toggle it off', () => {
    params = new URLSearchParams('specKey=wattage&specValue=50W')
    render(<FilterSidebar facets={facets({ specFacets: [{ key: 'wattage', values: [{ value: '50W', count: 1 }, { value: '100W', count: 2 }] }] })} />)
    fireEvent.click(screen.getByRole('button', { name: /Wattage/i }))
    fireEvent.click(screen.getByRole('button', { name: /100W/ }))
    expect(qs().get('specKey')).toBe('wattage')
    expect(qs().get('specValue')).toBe('100W')
    fireEvent.click(screen.getByRole('button', { name: /50W/ }))
    expect(qs().has('specKey')).toBe(false)
  })

  it('the compact layout uses lighter padding', () => {
    const { container } = render(<FilterSidebar facets={facets()} compact />)
    expect((container.firstChild as HTMLElement).className).toContain('p-4')
    expect((container.firstChild as HTMLElement).className).not.toContain('sm:p-6')
  })
})
