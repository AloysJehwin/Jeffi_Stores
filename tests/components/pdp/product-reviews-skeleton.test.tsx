import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isLoading: false }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { aiStorefrontEnabled: false } }) }))

import ProductReviews from '@/components/visitor/ProductReviews'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProductReviews loading state', () => {
  it('renders a responsive card skeleton grid with sr-only status text', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<ProductReviews productId="p1" productName="Hammer" />)
    const skeleton = screen.getByTestId('reviews-skeleton')
    expect(skeleton.getAttribute('role')).toBe('status')
    expect(skeleton.className).toMatch(/sm:grid-cols-2/)
    expect(skeleton.className).toMatch(/xl:grid-cols-3/)
    expect(skeleton.children.length).toBe(4)
    expect(screen.getByText('Loading reviews').className).toContain('sr-only')
    expect(screen.queryByText('Loading reviews…')).toBeNull()
  })
})
