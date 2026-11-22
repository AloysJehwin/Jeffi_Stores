import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Stub the product chrome: assert what BuyAgainRow passes down, not ProductCard internals.
vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ id, name }: any) => <div data-testid="product-card" data-id={id}>{name}</div>,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import BuyAgainRow from '@/components/visitor/account/BuyAgainRow'

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

describe('BuyAgainRow (render + fetch branches)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when the feed returns no products', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ products: [] })))
    const { container } = render(<BuyAgainRow />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders nothing when the request fails (not ok)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)))
    const { container } = render(<BuyAgainRow />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('renders the heading, past-orders link and a card per product once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okJson({ products: [{ id: 'p1', name: 'Mug' }, { id: 'p2', name: 'Spoon' }] }))
    )
    render(<BuyAgainRow />)
    expect(await screen.findByText('Buy again')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Past orders' })).toHaveAttribute('href', '/account/orders')
    const cards = screen.getAllByTestId('product-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Mug')
    expect(screen.getByLabelText('Buy again')).toBeInTheDocument()
  })

  it('treats a non-array products payload as empty and renders nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okJson({ products: null })))
    const { container } = render(<BuyAgainRow />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })
})
