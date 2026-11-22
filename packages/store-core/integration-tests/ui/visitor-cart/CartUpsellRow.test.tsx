import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// CartUpsellRow GETs /api/products/affinity for ids in the cart, filters out anything already in the
// cart/saved, and renders the survivors as ProductCards inside a SectionCarousel. We stub both children to
// plain markers so the test is about the fetch/filter/visibility logic, not the card internals.

vi.mock('@/components/visitor/ProductCard', () => ({
  default: (p: { id: string; name?: string }) => <div data-testid="card">{p.name ?? p.id}</div>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="carousel">{children}</div>,
}))

import CartUpsellRow from '@/components/visitor/cart/CartUpsellRow'

function mockAffinity(products: { id: string; name?: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ products }) } as Response))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CartUpsellRow', () => {
  it('renders nothing when the cart is empty (no ids, no fetch)', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { container } = render(<CartUpsellRow cartProductIds={[]} savedProductIds={[]} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('renders the recommended products once the affinity fetch resolves', async () => {
    mockAffinity([
      { id: 'p10', name: 'Widget' },
      { id: 'p11', name: 'Gadget' },
    ])
    render(<CartUpsellRow cartProductIds={['p1']} savedProductIds={[]} />)
    expect(await screen.findByText('Frequently bought with your cart')).toBeInTheDocument()
    expect(screen.getByTestId('carousel')).toBeInTheDocument()
    expect(screen.getAllByTestId('card')).toHaveLength(2)
    expect(screen.getByText('Widget')).toBeInTheDocument()
  })

  it('filters out products already in the cart or saved list', async () => {
    mockAffinity([
      { id: 'p1', name: 'InCart' }, // excluded
      { id: 'p2', name: 'Saved' }, // excluded
      { id: 'p9', name: 'Fresh' }, // kept
    ])
    render(<CartUpsellRow cartProductIds={['p1']} savedProductIds={['p2']} />)
    expect(await screen.findByText('Fresh')).toBeInTheDocument()
    expect(screen.getAllByTestId('card')).toHaveLength(1)
    expect(screen.queryByText('InCart')).not.toBeInTheDocument()
  })

  it('renders nothing when the fetch returns an empty recommendation list', async () => {
    mockAffinity([])
    const { container } = render(<CartUpsellRow cartProductIds={['p1']} savedProductIds={[]} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
