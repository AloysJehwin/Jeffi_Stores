import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ProductPageProvider wires a lot of shared state and exposes it through useProductPage(). Here we mock
// every context + the purchase hook and assert the provider derives the right shared values and that a
// consumer rendered outside the provider gets null. (The heavy fetch effects are no-ops here.)

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn(), showConfirm: vi.fn() }) }))
vi.mock('@/contexts/WishlistContext', () => ({ useWishlist: () => ({ has: () => false, toggle: vi.fn() }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({
  useStoreConfig: () => ({ flags: { gstEnabled: false, digitalProductsEnabled: false } }),
}))

// The purchase hook is exercised by its own tests; echo its input back so we can assert wiring.
const purchaseInputs: any[] = []
vi.mock('@/components/visitor/ProductActions', () => ({
  useProductPurchase: (input: any) => {
    purchaseInputs.push(input)
    return { __purchase: true }
  },
}))

import { ProductPageProvider, useProductPage } from '@/components/visitor/pdp/ProductPageProvider'

function Probe() {
  const state = useProductPage()
  if (!state) return <div>no-context</div>
  return (
    <div>
      <span data-testid="name">{state.product.name}</span>
      <span data-testid="price">{state.displayPrice}</span>
      <span data-testid="variants">{String(state.hasVariants)}</span>
      <span data-testid="return-allowed">{String(state.policy.returnAllowed)}</span>
      <span data-testid="images">{state.images.length}</span>
    </div>
  )
}

const product: any = {
  id: 'p1',
  name: 'Camera',
  sku: 'CAM1',
  slug: 'camera',
  base_price: 999,
  stock_status: 'In Stock',
  has_variants: false,
  return_window_days: 7,
  product_images: [{ id: 'i1', image_url: '/a.jpg', thumbnail_url: '/a-t.jpg', is_primary: true }],
  product_variants: [],
}

beforeEach(() => {
  purchaseInputs.length = 0
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.stubGlobal('scrollTo', vi.fn())
})

describe('ProductPageProvider (context contract)', () => {
  it('returns null from useProductPage outside a provider', () => {
    render(<Probe />)
    expect(screen.getByText('no-context')).toBeInTheDocument()
  })

  it('exposes the product and derived display price to consumers', () => {
    render(
      <ProductPageProvider product={product}>
        <Probe />
      </ProductPageProvider>
    )
    expect(screen.getByTestId('name')).toHaveTextContent('Camera')
    expect(screen.getByTestId('price')).toHaveTextContent('999')
    expect(screen.getByTestId('variants')).toHaveTextContent('false')
    expect(screen.getByTestId('images')).toHaveTextContent('1')
  })

  it('derives hasVariants true only when variants exist', () => {
    render(
      <ProductPageProvider product={{ ...product, has_variants: true, product_variants: [{ id: 'v1', variant_name: 'Red', sku: 'R', price: 999, mrp: null, mrp_ex_gst: null, price_ex_gst: null, stock_status: 'In Stock' }] }}>
        <Probe />
      </ProductPageProvider>
    )
    expect(screen.getByTestId('variants')).toHaveTextContent('true')
  })

  it('resolves the return policy from the product return window', () => {
    render(
      <ProductPageProvider product={product}>
        <Probe />
      </ProductPageProvider>
    )
    expect(screen.getByTestId('return-allowed')).toHaveTextContent('true')
    // The purchase hook received the product identity.
    expect(purchaseInputs[0]).toMatchObject({ productId: 'p1', productName: 'Camera', sku: 'CAM1' })
  })
})
