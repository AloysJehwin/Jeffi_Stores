import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import ProductsSearch from '@/components/visitor/ProductsSearch'

const fetchMock = vi.fn()
const results = (over: Record<string, any> = {}) => ({
  categories: [{ id: 'c1', name: 'Audio gear', slug: 'audio' }],
  brands: [{ id: 'b1', name: 'Halo', slug: 'halo', logo_url: null }, { id: 'b2', name: 'Halogen', slug: 'halogen', logo_url: '/h.png' }],
  products: [
    { id: 'p1', name: 'Halo Speaker', slug: 'halo-speaker', base_price: 1000, price_ex_gst: 900, has_variants: false, variant_min_price: null, product_images: [{ image_url: '/a.png', thumbnail_url: '/t.png', is_primary: true }] },
    { id: 'p2', name: 'Halo Sub', slug: 'halo-sub', base_price: 2000, price_ex_gst: null, has_variants: true, variant_min_price: 1500, product_images: [] },
  ],
  ...over,
})
const respond = (data: any, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => data })

async function search(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250)
  })
}

describe('ProductsSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    push.mockReset()
    respond(results())
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.useRealTimers())

  it('starts with the default value and no dropdown, and does not search below 2 characters', async () => {
    render(<ProductsSearch defaultValue="speaker" />)
    expect(screen.getByPlaceholderText('Search products...')).toHaveValue('speaker')
    await search('h')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('debounces then shows categories, brands and products with highlighted matches and prices', async () => {
    render(<ProductsSearch />)
    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: 'ha' } })
    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: 'halo' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=halo')
    expect(screen.getByText('Categories')).toBeInTheDocument()
    expect(screen.getByText('Brands')).toBeInTheDocument()
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getAllByText('Halo', { selector: 'mark' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Halo Speaker/ })).toHaveAttribute('href', '/products/halo-speaker')
    expect(screen.getByText(/₹900\.00/)).toBeInTheDocument()
    expect(screen.getByText(/From ₹1,500\.00/)).toBeInTheDocument()
    expect(screen.getByAltText('Halo Speaker')).toHaveAttribute('src', '/t.png')
    expect(screen.getByRole('link', { name: /Audio gear/ })).toHaveAttribute('href', '/products?category=audio')
    expect(screen.getAllByRole('link').some(l => l.getAttribute('href') === '/products?brand=halogen')).toBe(true)
    expect(screen.getByRole('link', { name: /See all results/ })).toHaveAttribute('href', '/products?search=halo')
  })

  it('uses a custom basePath for every link', async () => {
    render(<ProductsSearch basePath="/business/products" />)
    await search('halo')
    expect(screen.getByRole('link', { name: /Halo Speaker/ })).toHaveAttribute('href', '/business/products/halo-speaker')
    expect(screen.getByRole('link', { name: /Audio gear/ })).toHaveAttribute('href', '/business/products?category=audio')
  })

  it('shows an empty state when nothing matches', async () => {
    respond({ products: [], categories: [], brands: [] })
    render(<ProductsSearch />)
    await search('zzzz')
    expect(screen.getByText('No results for "zzzz"')).toBeInTheDocument()
  })

  it('stays closed when the request is not ok or throws', async () => {
    respond({}, false)
    render(<ProductsSearch />)
    await search('halo')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fetchMock.mockRejectedValue(new Error('offline'))
    await search('halos')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('submitting the form navigates to the search page and records the query', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<ProductsSearch portalHeader="business" />)
    fireEvent.change(screen.getByPlaceholderText('Search products...'), { target: { value: ' halo amp ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(push).toHaveBeenCalledWith('/products?search=halo%20amp')
    const hist = fetchMock.mock.calls.find(c => c[0] === '/api/user/search-history')!
    expect(hist[1].headers).toMatchObject({ 'X-Auth-Portal': 'business' })
    expect(JSON.parse(hist[1].body)).toEqual({ query: 'halo amp' })
  })

  it('does nothing when submitting an empty query', () => {
    render(<ProductsSearch />)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(push).not.toHaveBeenCalled()
  })

  it('Enter with the dropdown closed searches; Escape closes it', async () => {
    render(<ProductsSearch />)
    const box = screen.getByPlaceholderText('Search products...')
    fireEvent.change(box, { target: { value: 'h' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/products?search=h')
    await search('halo')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('arrow keys walk categories, brands then products, and Enter opens the active one', async () => {
    render(<ProductsSearch />)
    await search('halo')
    const box = screen.getByPlaceholderText('Search products...')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getByRole('link', { name: /Audio gear/ }).className).toContain('bg-surface-secondary')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(push).toHaveBeenLastCalledWith('/products?category=audio')
    await search('halo2')
    push.mockClear()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(push).toHaveBeenLastCalledWith('/products?brand=halo')
    await search('halo3')
    for (let i = 0; i < 4; i++) fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(push).toHaveBeenLastCalledWith('/products/halo-speaker')
  })

  it('ArrowUp steps back and clamps; Enter with no selection runs the full search', async () => {
    render(<ProductsSearch />)
    await search('halo')
    const box = screen.getByPlaceholderText('Search products...')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(push).toHaveBeenLastCalledWith('/products?search=halo')
  })

  it('clicking a result closes the dropdown and navigates', async () => {
    render(<ProductsSearch />)
    await search('halo')
    fireEvent.click(screen.getByRole('link', { name: /Halo Sub/ }))
    expect(push).toHaveBeenCalledWith('/products/halo-sub')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on an outside click and reopens on focus while results exist', async () => {
    render(<ProductsSearch />)
    await search('halo')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.focus(screen.getByPlaceholderText('Search products...'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('clearing the query empties the results', async () => {
    render(<ProductsSearch />)
    await search('halo')
    await search('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
