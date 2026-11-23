import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const useAuthMock = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

vi.mock('@/lib/catalog/pricing', () => ({
  applyDiscount: (price: number, pct: number) => Math.round(price * (1 - pct / 100)),
  mrpDiscountPct: (mrp: number, price: number) => Math.round(((mrp - price) / mrp) * 100),
}))
vi.mock('@/lib/shared/image-url', () => ({
  onImgError: vi.fn<(...a: any[]) => any>(),
  responsiveImg: (src: string) => ({ src }),
}))

import RecentlyViewed, { trackRecentlyViewed } from '@/components/visitor/RecentlyViewed'

const STORAGE_KEY = 'jeffi_recently_viewed'
const item = (over: Record<string, any> = {}) => ({
  id: 'p1',
  name: 'Blue Mug',
  slug: 'blue-mug',
  price: 300,
  mrp: 500,
  brand: 'Acme',
  inStock: true,
  image: '/a.jpg',
  categoryId: null,
  ...over,
})

function seed(items: any[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

describe('RecentlyViewed (render + branches)', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthMock.mockReturnValue({ user: null })
  })

  it('renders nothing below the minItems threshold', () => {
    seed([item(), item({ id: 'p2' })]) // 2 < default minItems 6
    const { container } = render(<RecentlyViewed />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the grid of stored products once minItems is met', () => {
    const items = Array.from({ length: 6 }, (_, i) => item({ id: `p${i}`, name: `Item ${i}`, slug: `item-${i}` }))
    seed(items)
    render(<RecentlyViewed minItems={6} />)
    expect(screen.getByText('Recently Viewed')).toBeInTheDocument()
    expect(screen.getByText('Item 0')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Item 0/ })).toHaveAttribute('href', '/products/item-0')
  })

  it('excludes the current product via excludeId', () => {
    const items = Array.from({ length: 7 }, (_, i) => item({ id: `p${i}`, name: `Item ${i}`, slug: `item-${i}` }))
    seed(items)
    render(<RecentlyViewed minItems={1} excludeId="p3" />)
    expect(screen.queryByText('Item 3')).not.toBeInTheDocument()
    expect(screen.getByText('Item 0')).toBeInTheDocument()
  })

  it('shows an MRP discount badge when mrp exceeds price', () => {
    seed([item({ id: 'x', name: 'Discounted', slug: 'd', price: 300, mrp: 500 })])
    render(<RecentlyViewed minItems={1} />)
    // (500-300)/500 = 40%
    expect(screen.getByText('40% off')).toBeInTheDocument()
  })

  it('uses a custom title and base path', () => {
    seed([item({ id: 'x', name: 'Solo', slug: 'solo' })])
    render(<RecentlyViewed minItems={1} title="Seen Lately" basePath="/shop" />)
    expect(screen.getByText('Seen Lately')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Solo/ })).toHaveAttribute('href', '/shop/solo')
  })

  it('trackRecentlyViewed prepends and de-dupes, capping at 7', () => {
    for (let i = 0; i < 9; i++) trackRecentlyViewed(item({ id: `p${i}`, slug: `s${i}` }))
    trackRecentlyViewed(item({ id: 'p8', slug: 's8' })) // already newest -> no dupe
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored).toHaveLength(7)
    expect(stored[0].id).toBe('p8')
    expect(stored.filter((p: any) => p.id === 'p8')).toHaveLength(1)
  })
})
