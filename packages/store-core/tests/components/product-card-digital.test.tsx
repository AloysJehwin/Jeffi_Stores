import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const flags = { gstEnabled: true, digitalProductsEnabled: true }
const resolveEdd = vi.fn(async () => '2026-10-10')

vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), showConfirm: vi.fn() }) }))
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => ({ has: () => false, toggle: vi.fn() }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))
vi.mock('@/lib/shipping/edd-cache', () => ({ resolveEdd: (...a: any[]) => resolveEdd(...(a as [])) }))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: () => null }))
vi.mock('@/components/visitor/QuickAddButton', () => ({ default: () => null }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: () => null }))

import ProductCard from '@/components/visitor/ProductCard'

const base = {
  id: 'p1',
  name: 'Movie',
  slug: 'movie',
  hasVariants: false,
  displayPrice: 199,
  mrp: null,
  mrpDiscount: 0,
  effectiveStock: 0,
}

beforeEach(() => {
  flags.digitalProductsEnabled = true
  resolveEdd.mockClear()
})

describe('ProductCard digital treatment', () => {
  it('shows the Digital badge and instant access, never out of stock or a delivery date', async () => {
    render(<ProductCard {...base} isDigital />)
    expect(screen.getByText('Digital')).toBeTruthy()
    expect(screen.getByText('Instant access')).toBeTruthy()
    expect(screen.queryByText('Out of Stock')).toBeNull()
    expect(resolveEdd).not.toHaveBeenCalled()
  })

  it('falls back to the physical treatment when the digital master switch is off', () => {
    flags.digitalProductsEnabled = false
    render(<ProductCard {...base} isDigital />)
    expect(screen.queryByText('Digital')).toBeNull()
    expect(screen.getByText('Out of Stock')).toBeTruthy()
  })
})
