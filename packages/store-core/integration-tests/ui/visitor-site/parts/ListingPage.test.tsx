import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const setListing = vi.hoisted(() => vi.fn())
vi.mock('@/components/visitor/site/code/parts/listing/context', () => ({ setListingParts: setListing }))

import ListingPageParts from '@/components/visitor/site/code/parts/listing/ListingPageParts'
import { ListingPageProvider, useListingPage } from '@/components/visitor/site/code/parts/listing/ListingPageProvider'

function Reader() {
  const s = useListingPage()
  return <div data-testid="state">{s ? `${s.kind}|${s.basePath}|${s.total}|${s.start}-${s.end}` : 'none'}</div>
}

const data = (over: any = {}) => ({ kind: 'category', basePath: '/categories/tools', products: [{}, {}, {}], total: 53, page: 2, pageSize: 24, filters: null, ...over }) as any

beforeEach(() => setListing.mockClear())

describe('ListingPageProvider / useListingPage', () => {
  it('is null outside a listing page', () => {
    render(<Reader />)
    expect(screen.getByTestId('state')).toHaveTextContent('none')
  })

  it('hands the page state to its client parts', () => {
    render(
      <ListingPageProvider value={{ kind: 'search', basePath: '/search', total: 9, start: 1, end: 9, filters: null }}>
        <Reader />
      </ListingPageProvider>,
    )
    expect(screen.getByTestId('state')).toHaveTextContent('search|/search|9|1-9')
  })
})

describe('ListingPageParts', () => {
  it('publishes the data and provides the shown range for the current page', () => {
    const d = data()
    render(<ListingPageParts data={d}><Reader /></ListingPageParts>)
    expect(setListing).toHaveBeenCalledWith(d)
    // Page 2 of 24 per page, 3 products shown: positions 25 to 27.
    expect(screen.getByTestId('state')).toHaveTextContent('category|/categories/tools|53|25-27')
  })

  it('reports an empty range when no products are shown', () => {
    render(<ListingPageParts data={data({ products: [], total: 0, page: 1 })}><Reader /></ListingPageParts>)
    expect(screen.getByTestId('state')).toHaveTextContent('category|/categories/tools|0|0-0')
  })

  it('renders its children', () => {
    render(<ListingPageParts data={data()}><p>Results</p></ListingPageParts>)
    expect(screen.getByText('Results')).toBeInTheDocument()
  })
})
