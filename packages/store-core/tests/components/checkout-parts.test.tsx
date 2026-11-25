// The AI Site Studio's cart and checkout parts share the built-in pages' state: an AI layout of the checkout parts
// must place exactly the order the built-in checkout places.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

const push = vi.fn()
const replace = vi.fn()
const clearCart = vi.fn()
let search = 'intent=tok'
const item = {
  id: 'ci1',
  product_id: 'p1',
  variant_id: null,
  sub_variant_id: null,
  quantity: 2,
  price_at_addition: 250,
  buy_mode: 'unit',
  buy_unit: null,
  cart_item_unit: null,
  products: { id: 'p1', name: 'Brass Lamp', slug: 'brass-lamp', sku: 'BL1', base_price: 250, price_ex_gst: 211.86, mrp: 300, gst_percentage: 18, stock_status: 'In Stock', brand_name: 'Acme', category_id: null, is_active: true, is_cod_allowed: true, product_images: [] },
  variant: null,
  sub_variant: null,
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/checkout',
}))
vi.mock('@/contexts/CartContext', () => ({
  useCart: () => ({
    cartItems: [item],
    savedItems: [],
    cartCount: 1,
    isLoading: false,
    getCartTotal: () => 500,
    getCartTax: () => 76.27,
    clearCart,
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
    saveForLater: vi.fn(),
    moveToCart: vi.fn(),
  }),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: null, phone: null }, isLoading: false }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('@/contexts/StoreConfigContext', () => ({
  useStoreConfig: () => ({ flags: { razorpayEnabled: false, codEnabled: true, gstEnabled: true, upiEnabled: false }, identity: { name: 'Shop', email: 's@x.in', phone: '' } }),
}))
vi.mock('@/components/visitor/FeaturedForYou', () => ({ default: () => null }))
vi.mock('@/components/visitor/cart/MobileCheckoutBar', () => ({ default: () => null }))
vi.mock('@/components/visitor/cart/CouponNudge', () => ({ default: () => null }))
vi.mock('@/components/visitor/cart/YourCoupons', () => ({ default: () => null }))
vi.mock('@/components/visitor/cart/CartUpsellRow', () => ({ default: () => null }))
vi.mock('@/components/storefront-ai/CartInsightPanel', () => ({ default: () => null }))
vi.mock('@/lib/client/analytics', () => ({ trackBeginCheckout: vi.fn() }))
vi.mock('@/components/payments', () => ({
  PaymentSections: ({ value, onChange, cod }: any) => (
    <div>
      {cod && (
        <label>
          <input type="radio" checked={value === 'cod'} onChange={() => onChange('cod')} /> COD
        </label>
      )}
    </div>
  ),
  UpiManualDialog: () => null,
  razorpayDisplayConfig: () => ({}),
  upiFlag: (f: any) => !!f.upiEnabled,
  useUpiPayment: () => ({ manual: null, busy: false, error: null, start: vi.fn(), confirmUtr: vi.fn(), dismissManual: vi.fn(), clearError: vi.fn() }),
}))

import CheckoutView, { CheckoutGate } from '@/components/visitor/site/code/parts/checkout/CheckoutView'
import { CheckoutProvider } from '@/components/visitor/site/code/parts/checkout/context'
import { AddressFormPart, DeliveryOptionsPart, OrderSummaryPart, PaymentStepPart } from '@/components/visitor/site/code/parts/checkout/parts'
import CartView from '@/components/visitor/site/code/parts/cart/CartView'
import { CartPartsProvider } from '@/components/visitor/site/code/parts/cart/context'
import { CartLinesPart, CartSummaryPart, CheckoutButtonPart } from '@/components/visitor/site/code/parts/cart/parts'

const calls: { url: string; body: any }[] = []
beforeEach(() => {
  calls.length = 0
  push.mockReset()
  search = 'intent=tok'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ url, body })
      const json =
        url.startsWith('/api/checkout/intents/') ? { mode: 'cart', addressId: 'a1', shippingCharge: 40 }
        : url === '/api/checkout/intents' ? { intent: 'new-intent' }
        : url === '/api/user/addresses' ? { addresses: [{ id: 'a1', full_name: 'Test Person', address_line1: '1 Road', city: 'Pune', state: 'MH', postal_code: '411001', country: 'IN', phone: '999' }] }
        : url === '/api/shipping/rate' ? { charge: 40, codFee: 0, serviceable: true }
        : url === '/api/orders/create' ? { order: { id: 'o1' } }
        : {}
      return { ok: true, status: 200, json: async () => json }
    })
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function placeCod() {
  const btn = await screen.findByRole('button', { name: /place order — pay on delivery/i })
  fireEvent.submit(btn.closest('form')!)
  await waitFor(() => expect(calls.some(c => c.url === '/api/orders/create')).toBe(true))
  return calls.find(c => c.url === '/api/orders/create')!.body
}

describe('cart and checkout parts', () => {
  it('built-in checkout and an AI composition place the same order', async () => {
    render(<CheckoutView />)
    expect(await screen.findByText('Place Order')).toBeTruthy()
    const builtIn = await placeCod()
    expect(push).toHaveBeenCalledWith('/account/orders/confirmation?orderId=o1')
    cleanup()
    calls.length = 0
    push.mockReset()

    const Section = ({ children }: { children: ReactNode }) => <section>{children}</section>
    render(
      <CheckoutProvider builtInPayment={false}>
        <CheckoutGate>
          <Section>
            <PaymentStepPart />
          </Section>
          <Section>
            <OrderSummaryPart />
            <AddressFormPart />
            <DeliveryOptionsPart />
          </Section>
        </CheckoutGate>
      </CheckoutProvider>
    )
    expect(await screen.findByText('Test Person')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Any special instructions or requests...'), { target: { value: 'ring bell' } })
    const ai = await placeCod()
    expect(push).toHaveBeenCalledWith('/account/orders/confirmation?orderId=o1')
    expect(ai).toEqual({ ...builtIn, notes: 'ring bell' })
    expect(builtIn).toMatchObject({ paymentMethod: 'cod', shippingAmount: 40, codFeeAmount: 0, couponId: null, discountAmount: 0 })
  })

  it('cart parts in any order share one cart', async () => {
    render(<CartView />)
    expect(screen.getByText('Shopping Cart')).toBeTruthy()
    cleanup()
    render(
      <CartPartsProvider>
        <CheckoutButtonPart />
        <CartSummaryPart />
        <CartLinesPart variant="cards" />
      </CartPartsProvider>
    )
    expect(screen.getAllByText('Brass Lamp').length).toBeGreaterThan(0)
    expect(screen.getByText('Total')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout/review?intent=new-intent'))
  })
})
