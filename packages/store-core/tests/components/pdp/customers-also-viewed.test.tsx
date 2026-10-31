import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ name }: { name: string }) => <div data-testid="card">{name}</div>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) => (
    <div aria-label={ariaLabel}>{children}</div>
  ),
}))

import CustomersAlsoViewed from '@/components/visitor/pdp/CustomersAlsoViewed'

const product = (id: string, name: string) => ({
  id,
  name,
  slug: id,
  hasVariants: true,
  displayPrice: 10,
  mrp: null,
  mrpDiscount: 0,
  effectiveStock: 3,
  primaryImage: null,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CustomersAlsoViewed', () => {
  it('shows a card per co-viewed product from the affinity API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ products: [product('a', 'Spring Washer'), product('b', 'Hex Key')] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<CustomersAlsoViewed productId="p-1" />)

    expect(await screen.findByRole('heading', { name: 'Customers also viewed' })).toBeTruthy()
    expect(screen.getAllByTestId('card').map(c => c.textContent)).toEqual(['Spring Washer', 'Hex Key'])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/affinity?kind=viewed&ids=p-1&limit=8')
  })

  it('renders nothing when nobody viewed anything else or the request fails', async () => {
    for (const response of [
      { ok: true, json: async () => ({ products: [] }) },
      { ok: false, json: async () => ({}) },
    ]) {
      const fetchMock = vi.fn().mockResolvedValue(response)
      vi.stubGlobal('fetch', fetchMock)
      const { container, unmount } = render(<CustomersAlsoViewed productId="p-1" />)
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      await act(async () => {})
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })
})
