import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const replace = vi.fn<(...a: any[]) => any>()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}))

// Deep import of the sort contract — stub with a stable set so assertions don't track the real list.
vi.mock('@jeffi/api-contracts/src/product-sort', () => {
  const PRODUCT_SORTS = [
    { id: 'relevance', label: 'Relevance', sort: undefined, dir: undefined },
    { id: 'price-asc', label: 'Price: Low to High', sort: 'price', dir: 'asc' },
    { id: 'newest', label: 'Newest First', sort: 'created', dir: 'desc' },
  ]
  return {
    PRODUCT_SORTS,
    productSortKey: (sort: string | null, dir: string | null) => {
      const hit = PRODUCT_SORTS.find(o => o.sort === sort && o.dir === dir)
      return hit ? hit.id : 'relevance'
    },
  }
})

import SortDropdown from '@/components/visitor/SortDropdown'

describe('SortDropdown (render + selection)', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams()
  })

  it('renders the label and the current (default) option on the combobox', () => {
    render(<SortDropdown />)
    expect(screen.getByText('Sort by:')).toBeInTheDocument()
    const combo = screen.getByRole('combobox')
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).toHaveTextContent('Relevance')
  })

  it('reflects the sort/dir from the URL as the selected option', () => {
    searchParams = new URLSearchParams('sort=price&dir=asc')
    render(<SortDropdown />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Price: Low to High')
  })

  it('opens the listbox on click and lists every option', () => {
    render(<SortDropdown />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('navigates with the chosen sort params and drops page, then closes', () => {
    render(<SortDropdown basePath="/shop" />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: /Newest First/ }))
    expect(replace).toHaveBeenCalledWith('/shop?sort=created&dir=desc')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clears sort params for the relevance (no sort/dir) option', () => {
    searchParams = new URLSearchParams('sort=price&dir=asc&page=2')
    render(<SortDropdown />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Relevance' }))
    // No sort/dir and page dropped -> bare basePath.
    expect(replace).toHaveBeenCalledWith('/products')
  })

  it('marks the active option aria-selected', () => {
    searchParams = new URLSearchParams('sort=created&dir=desc')
    render(<SortDropdown />)
    fireEvent.click(screen.getByRole('combobox'))
    const selected = screen.getByRole('option', { name: /Newest First/ })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Relevance' })).toHaveAttribute('aria-selected', 'false')
  })
})
