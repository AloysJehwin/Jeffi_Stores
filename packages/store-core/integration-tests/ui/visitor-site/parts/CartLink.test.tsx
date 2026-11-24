import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const m = vi.hoisted(() => ({ pulse: false, fly: null as any }))

vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: React.forwardRef(function MockLink({ href, children, ...rest }: any, ref: any) {
      return <a ref={ref} href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>
    }),
  }
})
vi.mock('@/contexts/FlyToCartContext', () => ({ useFlyToCart: () => m.fly }))
vi.mock('@/lib/client/use-cart-pulse', () => ({ useCartPulse: () => m.pulse }))

import CartLink, { HEADER_CART_CLASS } from '@/components/visitor/site/code/parts/chrome/CartLink'

beforeEach(() => {
  m.pulse = false
  m.fly = null
})

describe('CartLink', () => {
  it('links to the cart and shows the item count', () => {
    render(<CartLink count={3} />)
    const link = screen.getByRole('link', { name: 'Cart, 3 items' })
    expect(link).toHaveAttribute('href', '/cart')
    expect(link).toHaveTextContent('3')
    expect(link).toHaveClass(...HEADER_CART_CLASS.split(' ').slice(0, 2))
  })

  it('shows no badge for an empty cart, or when the count is hidden', () => {
    const { rerender } = render(<CartLink count={0} />)
    expect(screen.getByRole('link', { name: 'Cart' })).not.toHaveTextContent(/\d/)
    rerender(<CartLink count={4} showCount={false} />)
    expect(screen.getByRole('link', { name: 'Cart, 4 items' })).not.toHaveTextContent(/\d/)
  })

  it('pulses the badge when the cart changes and takes a custom class', () => {
    m.pulse = true
    render(<CartLink count={2} className="my-cart" />)
    expect(screen.getByText('2')).toHaveClass('animate-cart-pulse')
    expect(screen.getByRole('link')).toHaveClass('my-cart')
  })

  it('registers itself as the fly-to-cart target and clears it on unmount', () => {
    m.fly = { setCartTarget: vi.fn() }
    const { unmount } = render(<CartLink count={1} />)
    expect(m.fly.setCartTarget).toHaveBeenLastCalledWith(screen.getByRole('link'))
    unmount()
    expect(m.fly.setCartTarget).toHaveBeenLastCalledWith(null)
  })
})
