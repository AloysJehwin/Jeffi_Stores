import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Fetches /api/products/affinity (co-views) on mount; renders a carousel of ProductCards or null when empty.
// Child presentation components are stubbed so this test is about the fetch->render branch.

vi.mock('@/components/visitor/ProductCard', () => ({
  default: (p: { name: string }) => <div data-testid="card">{p.name}</div>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: (p: { children: any; ariaLabel: string }) => <div aria-label={p.ariaLabel}>{p.children}</div>,
}))

import CustomersAlsoViewed from '@/components/visitor/pdp/CustomersAlsoViewed'

function mockFetch(products: any[], ok = true) {
  const fn = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ ok, json: () => Promise.resolve({ products }) } as Response))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

describe('CustomersAlsoViewed (render + branches)', () => {
  it('renders nothing before the affinity fetch resolves', () => {
    mockFetch([]) // resolves to empty
    const { container } = render(<CustomersAlsoViewed productId="p1" />)
    // Synchronous first paint: no products yet.
    expect(container.querySelector('[data-testid="card"]')).toBeNull()
  })

  it('renders the carousel of cards once products arrive', async () => {
    mockFetch([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }])
    render(<CustomersAlsoViewed productId="p1" />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Customers also viewed' })).toBeInTheDocument()
  })

  it('requests the viewed-affinity endpoint with the product id', async () => {
    const fn = mockFetch([{ id: 'a', name: 'Alpha' }])
    render(<CustomersAlsoViewed productId="p1" />)
    await screen.findByText('Alpha')
    expect(String(fn.mock.calls[0][0])).toContain('/api/products/affinity?kind=viewed&ids=p1')
  })

  it('stays empty when the response has no products', async () => {
    mockFetch([])
    const { container } = render(<CustomersAlsoViewed productId="p1" />)
    // Give the resolved promise a tick.
    await Promise.resolve()
    expect(container.firstChild).toBeNull()
  })
})
