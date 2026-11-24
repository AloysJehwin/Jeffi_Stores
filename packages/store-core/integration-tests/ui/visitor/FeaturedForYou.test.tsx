import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/ProductCard', () => ({ default: (p: any) => <div data-testid="visitor-card">{p.name}</div> }))
vi.mock('@/components/business/ProductCard', () => ({ default: (p: any) => <div data-testid="business-card">{p.name}</div> }))

import FeaturedForYou from '@/components/visitor/FeaturedForYou'

const fetchMock = vi.fn()
const prods = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Product ${i}` }))
const reply = (data: any, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => data })

describe('FeaturedForYou', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('asks for personalised picks with credentials', async () => {
    reply({ products: [] })
    render(<FeaturedForYou />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/recommendations/for-you', { credentials: 'include' }))
  })

  it('renders nothing for the best-sellers fallback (logged-out visitors), an error or a network failure', async () => {
    reply({ products: prods(3), fallback: true })
    const a = render(<FeaturedForYou />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()
    reply(null, false)
    const b = render(<FeaturedForYou />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()
    fetchMock.mockRejectedValue(new Error('offline'))
    const c = render(<FeaturedForYou />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(c.container).toBeEmptyDOMElement()
  })

  it('shows a section with the default heading, an explore link and one card per product', async () => {
    reply({ products: prods(3) })
    render(<FeaturedForYou href="/shop" />)
    expect(await screen.findAllByTestId('visitor-card')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 2 }).textContent!.length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Explore more/ })).toHaveAttribute('href', '/shop')
  })

  it('a custom title replaces the default and the limit caps the cards', async () => {
    reply({ products: prods(6) })
    render(<FeaturedForYou title="Picked for Asha" limit={2} />)
    expect(await screen.findByRole('heading', { name: 'Picked for Asha' })).toBeInTheDocument()
    expect(screen.getAllByTestId('visitor-card')).toHaveLength(2)
  })

  it('compact mode is a boxed block without the explore link, with an h3', async () => {
    reply({ products: prods(2) })
    render(<FeaturedForYou compact title="You might also like" />)
    expect(await screen.findByRole('heading', { level: 3, name: 'You might also like' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Explore more/ })).not.toBeInTheDocument()
  })

  it('the business variant draws business product cards', async () => {
    reply({ products: prods(2) })
    render(<FeaturedForYou variant="business" />)
    expect(await screen.findAllByTestId('business-card')).toHaveLength(2)
    expect(screen.queryByTestId('visitor-card')).not.toBeInTheDocument()
  })
})
