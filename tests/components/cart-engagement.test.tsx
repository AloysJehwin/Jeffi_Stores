import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ name }: { name: string }) => <div data-testid="upsell-card">{name}</div>,
}))

vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) => <div aria-label={ariaLabel}>{children}</div>,
}))

import FreeShippingProgress from '@/components/visitor/cart/FreeShippingProgress'
import CouponNudge from '@/components/visitor/cart/CouponNudge'
import CartUpsellRow from '@/components/visitor/cart/CartUpsellRow'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const SAVED = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

function stubFetch(payload: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => payload }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FreeShippingProgress', () => {
  it('shows how much more is needed and the progress towards the threshold', async () => {
    stubFetch({ freeThreshold: 1000, weightLimitKg: 3 })
    const { container } = render(<FreeShippingProgress subtotal={750} />)
    await waitFor(() => expect(container.textContent).toContain('Add ₹250.00 more to get free delivery'))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('75')
    expect(container.textContent).toContain('Free delivery on orders of ₹1,000.00 or more, for parcels under 3 kg.')
  })

  it('says free delivery is unlocked once the subtotal reaches the threshold', async () => {
    stubFetch({ freeThreshold: 1000, weightLimitKg: 3 })
    render(<FreeShippingProgress subtotal={1000} />)
    expect(await screen.findByText('You have unlocked free delivery')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  it('renders nothing when the store has no free-delivery threshold', async () => {
    const fetchMock = stubFetch({ freeThreshold: 0, weightLimitKg: 3 })
    const { container } = render(<FreeShippingProgress subtotal={750} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/cart/free-delivery'))
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for an empty cart', async () => {
    stubFetch({ freeThreshold: 1000, weightLimitKg: 3 })
    const { container } = render(<FreeShippingProgress subtotal={0} />)
    await settle()
    expect(container.innerHTML).toBe('')
  })
})

describe('CouponNudge', () => {
  it('offers one-click apply of the best coupon to a signed-in shopper', async () => {
    const fetchMock = stubFetch({ nudge: { code: 'SAVE10', saving: 123.45, shortfall: 0 } })
    const onApply = vi.fn()
    const { container } = render(<CouponNudge subtotal={1234.5} signedIn applying={false} onApply={onApply} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith('SAVE10')
    expect(container.textContent).toContain('Use SAVE10 to save ₹123.45')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/coupons/nudge?subtotal=1234.5')
  })

  it('asks a guest to log in, since coupons apply to signed-in accounts only', async () => {
    stubFetch({ nudge: { code: 'SAVE10', saving: 50, shortfall: 0 } })
    render(<CouponNudge subtotal={500} signedIn={false} applying={false} onApply={vi.fn()} />)
    const link = await screen.findByRole('link', { name: 'Log in to apply' })
    expect(link.getAttribute('href')).toBe('/login?redirect=/cart')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('tells the shopper how much more unlocks a coupon, without an apply action', async () => {
    stubFetch({ nudge: { code: 'NEAR', saving: 100, shortfall: 200 } })
    const { container } = render(<CouponNudge subtotal={800} signedIn applying={false} onApply={vi.fn()} />)
    await waitFor(() => expect(container.textContent).toContain('Add ₹200.00 more to unlock NEAR and save ₹100.00'))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('disables apply while a coupon is being applied', async () => {
    stubFetch({ nudge: { code: 'SAVE10', saving: 50, shortfall: 0 } })
    render(<CouponNudge subtotal={500} signedIn applying onApply={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Applying...' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nothing when there is no public coupon to suggest', async () => {
    const fetchMock = stubFetch({ nudge: null })
    const { container } = render(<CouponNudge subtotal={500} signedIn applying={false} onApply={vi.fn()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await settle()
    expect(container.innerHTML).toBe('')
  })
})

describe('CartUpsellRow', () => {
  it('asks for products bought with the cart, excluding cart and saved items, and hides them if returned', async () => {
    const fetchMock = stubFetch({
      products: [
        { id: OTHER, name: 'Wall plug' },
        { id: SAVED, name: 'Already saved' },
      ],
    })
    render(<CartUpsellRow cartProductIds={[B, A, B]} savedProductIds={[SAVED]} />)
    expect(await screen.findByText('Wall plug')).toBeTruthy()
    expect(screen.queryByText('Already saved')).toBeNull()
    expect(screen.getByText('Frequently bought with your cart')).toBeTruthy()

    const url = new URL(fetchMock.mock.calls[0]![0], 'http://localhost')
    expect(url.pathname).toBe('/api/products/affinity')
    expect(url.searchParams.get('kind')).toBe('bought')
    expect(url.searchParams.get('ids')).toBe(`${A},${B}`)
    expect(url.searchParams.get('exclude')).toBe(`${A},${B},${SAVED}`)
    expect(url.searchParams.get('limit')).toBe('8')
  })

  it('renders nothing when there is nothing to suggest', async () => {
    const fetchMock = stubFetch({ products: [] })
    const { container } = render(<CartUpsellRow cartProductIds={[A]} savedProductIds={[]} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('does not call the API for an empty cart', async () => {
    const fetchMock = stubFetch({ products: [{ id: OTHER, name: 'Wall plug' }] })
    const { container } = render(<CartUpsellRow cartProductIds={[]} savedProductIds={[SAVED]} />)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })
})
