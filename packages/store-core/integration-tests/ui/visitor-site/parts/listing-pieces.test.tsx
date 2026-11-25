import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params }))
vi.mock('@/components/visitor/FilterSidebar', () => ({ default: ({ basePath }: any) => <div data-testid="sidebar" data-base={basePath} /> }))
vi.mock('@/components/visitor/MobileFilterSheet', () => ({ default: ({ always }: any) => <div data-testid="sheet" data-always={String(always)} /> }))
vi.mock('@/components/visitor/SortDropdown', () => ({ default: ({ basePath }: any) => <div data-testid="sort" data-base={basePath} /> }))

import { FiltersPart, SortMenuPart, ResultCountPart } from '@/components/visitor/site/code/parts/listing/pieces'
import { ListingPageProvider } from '@/components/visitor/site/code/parts/listing/ListingPageProvider'

const filters = { facets: { inStockCount: 7, onSaleCount: 0 }, categories: [], brands: [], offers: [] }
const state = (over: any = {}) => ({ kind: 'category', basePath: '/categories/tools', total: 53, start: 25, end: 48, filters, ...over })
const within = (ui: React.ReactNode, over: any = {}) => render(<ListingPageProvider value={state(over)}>{ui}</ListingPageProvider>)

beforeEach(() => {
  nav.params = new URLSearchParams()
})

describe('FiltersPart', () => {
  it('renders nothing outside a listing page or without filters', () => {
    const { container, unmount } = render(<FiltersPart />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    const inside = within(<FiltersPart />, { filters: null })
    expect(inside.container).toBeEmptyDOMElement()
  })

  it('draws the sidebar on desktop and the sheet on mobile by default', () => {
    within(<FiltersPart />)
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-base', '/categories/tools')
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-always', 'false')
  })

  it('draws only the always-visible sheet for the drawer layout', () => {
    within(<FiltersPart layout="drawer" className="mine" />)
    expect(screen.queryByTestId('sidebar')).toBeNull()
    expect(screen.getByTestId('sheet')).toHaveAttribute('data-always', 'true')
  })

  it('draws quick toggles in the top layout, hiding ones with nothing to filter', () => {
    within(<FiltersPart layout="top" />)
    const inStock = screen.getByRole('link', { name: /In stock/ })
    expect(inStock).toHaveAttribute('href', '/categories/tools?inStock=1')
    expect(inStock).toHaveAttribute('aria-pressed', 'false')
    expect(inStock).toHaveTextContent('(7)')
    expect(screen.queryByRole('link', { name: /On sale/ })).toBeNull()
  })

  it('turns an active toggle off, dropping paging', () => {
    nav.params = new URLSearchParams('inStock=1&page=3&sort=price')
    within(<FiltersPart layout="top" />)
    const inStock = screen.getByRole('link', { name: 'In stock' })
    expect(inStock).toHaveAttribute('aria-pressed', 'true')
    expect(inStock).toHaveAttribute('href', '/categories/tools?sort=price')
  })
})

describe('SortMenuPart', () => {
  it('shows the sort menu when there is more than one result', () => {
    within(<SortMenuPart className="s" />)
    expect(screen.getByTestId('sort')).toHaveAttribute('data-base', '/categories/tools')
  })

  it('hides it for fewer than two results or outside a listing', () => {
    const one = within(<SortMenuPart />, { total: 1 })
    expect(one.container).toBeEmptyDOMElement()
    one.unmount()
    const none = render(<SortMenuPart />)
    expect(none.container).toBeEmptyDOMElement()
  })
})

describe('ResultCountPart', () => {
  it('shows the total with a noun', () => {
    within(<ResultCountPart noun="items" />)
    expect(screen.getByText('53 items')).toBeInTheDocument()
  })

  it('shows the range when asked, and just the total for an empty result', () => {
    const { unmount } = within(<ResultCountPart range />)
    expect(screen.getByText('Showing 25–48 of 53 products')).toBeInTheDocument()
    unmount()
    within(<ResultCountPart range />, { total: 0, start: 0, end: 0 })
    expect(screen.getByText('0 products')).toBeInTheDocument()
  })

  it('renders nothing outside a listing page', () => {
    const { container } = render(<ResultCountPart />)
    expect(container).toBeEmptyDOMElement()
  })
})
