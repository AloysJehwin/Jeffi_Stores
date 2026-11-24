import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  LISTING_GRID,
  LISTING_GRID_WIDE,
  ProductCardSkeleton,
  ProductGridSkeleton,
  SortDropdownSkeleton,
  ListingToolbarSkeleton,
  FilterSidebarSkeleton,
  ProductsListingSkeleton,
  TaxonomyIndexSkeleton,
  BreadcrumbSkeleton,
  TaxonomyDetailSkeleton,
} from '@/components/visitor/skeletons/listing'

describe('ProductGridSkeleton', () => {
  it('draws 6 cards by default in the listing grid', () => {
    const { container } = render(<ProductGridSkeleton />)
    expect((container.firstChild as HTMLElement).className).toBe(LISTING_GRID)
    expect(container.firstChild!.childNodes).toHaveLength(6)
  })

  it('honours count and a custom grid class', () => {
    const { container } = render(<ProductGridSkeleton count={3} className="my-grid" />)
    expect(container.firstChild).toHaveClass('my-grid')
    expect(container.firstChild!.childNodes).toHaveLength(3)
  })

  it('splices inserts before the card at their index, in order', () => {
    const { container } = render(
      <ProductGridSkeleton
        count={4}
        inserts={[
          { at: 0, node: <i data-testid="a" /> },
          { at: 2, node: <i data-testid="b" /> },
        ]}
      />
    )
    const kids = Array.from(container.firstChild!.childNodes) as HTMLElement[]
    expect(kids).toHaveLength(6)
    expect(kids[0].querySelector('[data-testid="a"]')).not.toBeNull()
    expect(kids[3].querySelector('[data-testid="b"]')).not.toBeNull()
  })

  it('appends no insert whose index is past the last card', () => {
    render(<ProductGridSkeleton count={2} inserts={[{ at: 9, node: <i data-testid="late" /> }]} />)
    expect(screen.queryByTestId('late')).not.toBeInTheDocument()
  })
})

describe('listing building blocks', () => {
  it('a product card shimmers with only its static footer copy', () => {
    const { container } = render(<ProductCardSkeleton />)
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(2)
    expect(container.textContent).toBe('Inclusive of all taxesView Details →')
  })

  it('the sort dropdown and toolbar keep their real labels', () => {
    render(<SortDropdownSkeleton />)
    expect(screen.getByText(/Sort by/)).toBeInTheDocument()
    const t = render(<ListingToolbarSkeleton />)
    expect(t.container.querySelectorAll('.sk').length).toBeGreaterThan(0)
  })

  it('the filter sidebar lists real section titles; categories can be dropped', () => {
    const a = render(<FilterSidebarSkeleton />)
    for (const t of ['Filters', 'Categories', 'Price Range', 'Availability', 'Offers', 'Brand']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.getByText('In Stock')).toBeInTheDocument()
    a.unmount()
    render(<FilterSidebarSkeleton categories={false} />)
    expect(screen.queryByText('Categories')).not.toBeInTheDocument()
    expect(screen.getByText('Price Range')).toBeInTheDocument()
  })

  it('the breadcrumb renders the trail with separators and a shimmering tail', () => {
    const { container } = render(<BreadcrumbSkeleton trail={['Home', 'Brands']} />)
    expect(container.textContent).toBe('Home/Brands/')
    expect(container.querySelector('.sk')).not.toBeNull()
  })
})

describe('ProductsListingSkeleton', () => {
  it('is a labelled busy status with heading and the filter sidebar', () => {
    render(<ProductsListingSkeleton subtitle="Showing everything" />)
    expect(screen.getByRole('status', { name: 'Loading products' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: 'All Products' })).toBeInTheDocument()
    expect(screen.getByText('Showing everything')).toBeInTheDocument()
    expect(screen.getAllByText('Filters').length).toBeGreaterThan(0)
    expect(screen.queryByText('Search products...')).not.toBeInTheDocument()
  })

  it('adds the search box for the business portal and honours a custom grid', () => {
    const { container } = render(
      <ProductsListingSkeleton search grid={{ count: 2, inserts: [{ at: 1, node: <i data-testid="ins" /> }] }} />
    )
    expect(screen.getByText('Search products...')).toBeInTheDocument()
    expect(screen.getByTestId('ins')).toBeInTheDocument()
    expect(container.querySelectorAll(`.${LISTING_GRID.split(' ')[0]}`).length).toBeGreaterThan(0)
  })
})

describe('TaxonomyIndexSkeleton', () => {
  it('shows the given title and subtitle for categories and brands', () => {
    render(<TaxonomyIndexSkeleton title="Categories" subtitle="Browse by type" kind="category" />)
    expect(screen.getByRole('status', { name: 'Loading Categories' })).toBeInTheDocument()
    expect(screen.getByText('Browse by type')).toBeInTheDocument()
    const b = render(<TaxonomyIndexSkeleton title="Brands" subtitle="Browse brands" kind="brand" />)
    expect(b.container.querySelectorAll('.sk').length).toBeGreaterThan(0)
  })
})

describe('TaxonomyDetailSkeleton', () => {
  it('category: breadcrumb, subcategories heading, products heading and the wide grid', () => {
    const { container } = render(<TaxonomyDetailSkeleton kind="category" />)
    expect(screen.getByRole('status', { name: 'Loading products' })).toBeInTheDocument()
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Subcategories' })).toBeInTheDocument()
    expect(screen.getByText(/Sort by/)).toBeInTheDocument()
    expect(container.querySelector('.' + LISTING_GRID_WIDE.split(' ')[0])).not.toBeNull()
  })

  it('brand: no subcategories, a logo placeholder, and toolbar instead of sort when asked', () => {
    render(<TaxonomyDetailSkeleton kind="brand" toolbar />)
    expect(screen.getByText('Brands')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Subcategories' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Sort by:/)).toBeInTheDocument()
  })
})
