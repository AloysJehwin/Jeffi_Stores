import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const push = vi.fn<(...a: any[]) => any>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import SearchBar from '@/components/visitor/SearchBar'

// Route fetches by URL: search-history vs /api/search.
function routeFetch(results: any = { products: [], categories: [], brands: [] }, history: string[] = []) {
  global.fetch = vi.fn<(...a: any[]) => any>((url: string) => {
    if (String(url).includes('search-history')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ history }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(results) })
  }) as any
}

const noop = () => {}

describe('SearchBar (render + interaction)', () => {
  beforeEach(() => {
    routeFetch()
    document.body.style.overflow = ''
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the trigger button and a hidden-state input when closed', () => {
    render(<SearchBar isOpen={false} onOpen={noop} onClose={noop} />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    // The input is present but not tabbable while closed.
    expect(screen.getByLabelText('Search products')).toHaveAttribute('tabindex', '-1')
  })

  it('calls onOpen when the trigger is tapped', () => {
    const onOpen = vi.fn<(...a: any[]) => any>()
    render(<SearchBar isOpen={false} onOpen={onOpen} onClose={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('makes the input tabbable when open', () => {
    render(<SearchBar isOpen={true} onOpen={noop} onClose={noop} />)
    expect(screen.getByLabelText('Search products')).toHaveAttribute('tabindex', '0')
  })

  it('shows recent searches when open with an empty query', async () => {
    routeFetch(undefined, ['shoes', 'bags'])
    render(<SearchBar isOpen={true} onOpen={noop} onClose={noop} />)
    await screen.findByText('Recent Searches')
    expect(screen.getByText('shoes')).toBeInTheDocument()
    expect(screen.getByText('bags')).toBeInTheDocument()
  })

  it('fetches and renders results after typing (debounced)', async () => {
    routeFetch({
      products: [
        {
          id: 'p1',
          name: 'Running Shoes',
          slug: 'running-shoes',
          base_price: 1999,
          price_ex_gst: null,
          has_variants: false,
          variant_min_price: null,
          product_images: [],
        },
      ],
      categories: [{ id: 'c1', name: 'Footwear', slug: 'footwear' }],
      brands: [],
    })
    render(<SearchBar isOpen={true} onOpen={noop} onClose={noop} />)
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'run' } })
    // "run" matches inside "Running", so Highlight splits the name; match the <mark> fragment.
    await screen.findByText('Run')
    expect(screen.getByText('ning Shoes')).toBeInTheDocument()
    expect(screen.getByText('Footwear')).toBeInTheDocument()
    // Category link uses the category filter param.
    expect(screen.getByText('Footwear').closest('a')).toHaveAttribute('href', '/products?category=footwear')
  })

  it('shows the empty state for a query with no matches', async () => {
    routeFetch({ products: [], categories: [], brands: [] })
    render(<SearchBar isOpen={true} onOpen={noop} onClose={noop} />)
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'zzz' } })
    await screen.findByText('No results for "zzz"')
  })

  it('submitting the form pushes the search URL and clears via onClose', async () => {
    const onClose = vi.fn<(...a: any[]) => any>()
    render(<SearchBar isOpen={true} onOpen={noop} onClose={onClose} />)
    const input = screen.getByLabelText('Search products')
    fireEvent.change(input, { target: { value: 'lamp' } })
    fireEvent.submit(input)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/products?search=lamp'))
    expect(onClose).toHaveBeenCalled()
  })
})
