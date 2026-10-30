import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
const addToCart = vi.fn()
const toggle = vi.fn(async () => 'added')
const showConfirm = vi.fn()
let wished = false
let user: any = { id: 'u1' }
let cartItems: any[] = []

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('motion/react', () => ({
  motion: { div: ({ children, initial, animate, transition, ...rest }: any) => <div {...rest}>{children}</div> },
  useReducedMotion: () => true,
}))
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart, cartItems }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), showConfirm }) }))
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => ({ has: () => wished, toggle }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled: true } }) }))

import QuickAddButton from '@/components/visitor/QuickAddButton'

const base = {
  productId: 'p1',
  productName: 'Movie',
  slug: 'movie',
  hasVariants: false,
  inStock: true,
  displayPrice: 199,
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /movie/i }))
}

beforeEach(() => {
  push.mockReset()
  addToCart.mockReset()
  toggle.mockClear()
  showConfirm.mockReset()
  wished = false
  user = { id: 'u1' }
  cartItems = []
  global.fetch = vi.fn() as any
})

describe('quick-add popup — digital products', () => {
  it('shows Buy Now (no quantity) and starts the buy-now intent instead of adding to cart', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ intent: 'tok' }) } as any)
    render(<QuickAddButton {...base} isDigital />)
    open()
    expect(screen.queryByText('Add to cart')).toBeNull()
    expect(screen.queryByText('Quantity')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Buy Now' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/review?intent=tok'))
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]!
    expect(url).toBe('/api/checkout/intents')
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ productId: 'p1', qty: 1 })
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('keeps Add to cart for physical products', () => {
    render(<QuickAddButton {...base} />)
    open()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Buy Now' })).toBeNull()
  })
})

describe('quick-add popup — like & share', () => {
  it('renders wishlist and share actions and toggles the wishlist', async () => {
    render(<QuickAddButton {...base} />)
    open()
    expect(screen.getByRole('button', { name: 'Share product' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('p1'))
  })

  it('marks a liked product as active', () => {
    wished = true
    render(<QuickAddButton {...base} />)
    open()
    const like = screen.getByRole('button', { name: 'Remove from wishlist' })
    expect(like.getAttribute('aria-pressed')).toBe('true')
  })

  it('prompts sign-in for guests instead of toggling', () => {
    user = null
    render(<QuickAddButton {...base} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(showConfirm).toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
  })

  it('shares via navigator.share with the product URL', async () => {
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<QuickAddButton {...base} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect((share.mock.calls[0] as any[])[0].url).toMatch(/\/products\/movie$/)
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('hides the wishlist in the business portal but keeps share', () => {
    render(<QuickAddButton {...base} portal="business" />)
    open()
    expect(screen.queryByRole('button', { name: 'Add to wishlist' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Share product' })).toBeTruthy()
  })
})

describe('quick-add variant picker', () => {
  const variantsResponse = (isDigital: boolean) => ({
    ok: true,
    json: async () => ({
      is_digital: isDigital,
      product_variants: [
        { id: 'v1', variant_name: 'Red', sku: 'R', price: 50, mrp: null, price_ex_gst: null, stock_status: 'In Stock' },
      ],
      product_units: isDigital
        ? []
        : [
            {
              id: 'u1',
              variant_id: null,
              sub_variant_id: null,
              unit: 'pc',
              factor: 1,
              is_base: true,
              is_purchase_default: true,
              display_label: 'pc',
              dimension: 'count',
              min_qty: 1,
              max_qty: 100,
              qty_step: 1,
            },
          ],
    }),
  })

  it('offers Buy Now for a digital product with options', async () => {
    vi.mocked(global.fetch).mockResolvedValue(variantsResponse(true) as any)
    render(<QuickAddButton {...base} hasVariants isDigital />)
    open()
    expect(await screen.findByRole('button', { name: 'Buy Now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull()
  })

  it('shows what is already in the cart and blocks adding once the line is at max_qty', async () => {
    vi.mocked(global.fetch).mockResolvedValue(variantsResponse(false) as any)
    cartItems = [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, buy_mode: 'pc', quantity: 100 }]
    render(<QuickAddButton {...base} hasVariants />)
    open()
    const btn = await screen.findByRole('button', { name: 'Max quantity already in cart' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the in-cart hint while the line still has room', async () => {
    vi.mocked(global.fetch).mockResolvedValue(variantsResponse(false) as any)
    cartItems = [{ product_id: 'p1', variant_id: 'v1', sub_variant_id: null, buy_mode: 'pc', quantity: 5 }]
    render(<QuickAddButton {...base} hasVariants />)
    open()
    expect(await screen.findByText('5 pc already in cart')).toBeTruthy()
    expect(screen.getByText(/Max: 95/)).toBeTruthy()
  })
})
