import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: ({ fragile }: any) => (fragile ? <span>Fragile</span> : null) }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <span data-testid="copy-sku" /> }))
vi.mock('@/components/visitor/cart/CouponNudge', () => ({ default: () => <div data-testid="nudge" /> }))
vi.mock('@/components/visitor/cart/YourCoupons', () => ({ default: () => <div data-testid="your-coupons" /> }))
vi.mock('@/components/visitor/cart/MobileCheckoutBar', () => ({
  default: ({ label, amount, children }: any) => (
    <div data-testid="mobile-bar">
      <span>{label}</span>
      <span>{amount}</span>
      {children}
    </div>
  ),
}))
vi.mock('@/components/visitor/site/code/parts/cart/context', () => ({}))

import {
  UnitLabel,
  CartEmptyPage,
  CartLinesEmptyBox,
  lineInfo,
  CartLineRow,
  CartLineCard,
  CartLineList,
  SavedForLater,
  CouponInput,
  SummaryTotals,
  CheckoutCta,
  ContinueShopping,
  CartMobileBar,
  SUMMARY_CTA_ID,
} from '@/components/visitor/site/code/parts/cart/pieces'

const line = (over: any = {}) => ({
  id: 'l1',
  quantity: 2,
  price_at_addition: 100,
  buy_unit: null,
  cart_item_unit: null,
  variant: null,
  sub_variant: null,
  products: { name: 'Drill', slug: 'drill', base_price: 1000, mrp: 1250, sku: 'DR-1', brand_name: 'Bosch', stock_status: 'In Stock', is_active: true, product_images: [{ is_primary: true, image_url: '/d.jpg', thumbnail_url: '/d-t.jpg' }] },
  ...over,
})

const parts = (over: any = {}): any => ({
  cartItems: [line()],
  savedItems: [],
  cartCount: 2,
  user: { id: 'u1' },
  gstEnabled: true,
  hasInactiveItems: false,
  updatingItems: new Set<string>(),
  couponCode: '',
  setCouponCode: vi.fn(),
  appliedCoupon: null,
  couponLoading: false,
  couponError: '',
  setCouponError: vi.fn(),
  handleApplyCoupon: vi.fn(),
  handleRemoveCoupon: vi.fn(),
  proceedingToCheckout: false,
  proceedToCheckout: vi.fn(),
  handleQuantityChange: vi.fn(),
  handleRemove: vi.fn(),
  handleSaveForLater: vi.fn(),
  handleMoveToCart: vi.fn(),
  total: 2000,
  physicalTotal: 2000,
  tax: 305,
  discount: 0,
  finalTotal: 2000,
  ...over,
})

describe('UnitLabel', () => {
  it('writes ft2 and m2 with a superscript', () => {
    const { container } = render(<UnitLabel label="ft2" />)
    expect(container).toHaveTextContent('ft2')
    expect(container.querySelector('sup')).toHaveTextContent('2')
    const plain = render(<UnitLabel label="kg" />)
    expect(plain.container).toHaveTextContent('kg')
    expect(plain.container.querySelector('sup')).toBeNull()
  })
})

describe('empty states', () => {
  it('CartEmptyPage invites shopping, with an optional coupon notice', () => {
    render(<CartEmptyPage couponNotice={<p>Coupon saved</p>} />)
    expect(screen.getByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument()
    expect(screen.getByText('Coupon saved')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse Products' })).toHaveAttribute('href', '/products')
  })

  it('CartLinesEmptyBox points at saved items and the catalogue', () => {
    render(<CartLinesEmptyBox />)
    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'browse products' })).toHaveAttribute('href', '/products')
  })
})

describe('lineInfo', () => {
  it('works out price, MRP discount, sku and default quantity rules', () => {
    const info = lineInfo(line(), new Set())
    expect(info.price).toBe(1000)
    expect(info.itemTotal).toBe(2000)
    expect(info.showMrp).toBe(true)
    expect(info.discountPct).toBe(20)
    expect(info.sku).toBe('DR-1')
    expect(info.qtyMin).toBe(1)
    expect(info.qtyStep).toBe(1)
    expect(info.qtyMax).toBeUndefined()
    expect(info.primaryImage?.image_url).toBe('/d.jpg')
  })

  it('prefers variant, then sub-variant prices and stock', () => {
    const info = lineInfo(line({ variant: { price: 900, mrp: 900, sku: 'V1', stock_status: 'Out of Stock' }, sub_variant: { price: 800, sku: 'S1' } }), new Set())
    expect(info.price).toBe(800)
    expect(info.sku).toBe('S1')
    expect(info.isOutOfStock).toBe(true)
    expect(info.mrp).toBe(900) // the sub-variant has none, so the variant's applies
    expect(info.showMrp).toBe(true)
  })

  it('prices measured lines by the price at addition, and multiplies pack sizes', () => {
    const custom = lineInfo(line({ quantity: '2.5', cart_item_unit: { dimension: 'length', display_label: 'm', min_qty: 0.5, qty_step: 0.5 } }), new Set())
    expect(custom.isCustomQty).toBe(true)
    expect(custom.price).toBe(100)
    expect(custom.itemTotal).toBe(250)
    expect(custom.qtyMin).toBe(0.5)
    const pack = lineInfo(line({ cart_item_unit: { dimension: 'count', factor: 6 } }), new Set())
    expect(pack.unitFactor).toBe(6)
    expect(pack.price).toBe(6000)
  })

  it('flags inactive products, updating lines and caps digital lines at one', () => {
    const info = lineInfo(line({ is_digital: true, products: { ...line().products, is_active: false } }), new Set(['l1']))
    expect(info.isInactive).toBe(true)
    expect(info.isUpdating).toBe(true)
    expect(info.qtyMax).toBe(1)
  })
})

describe('CartLineRow', () => {
  it('shows the product, brand, sku, price, discount and subtotal', () => {
    render(<CartLineRow item={line()} c={parts()} />)
    for (const link of screen.getAllByRole('link', { name: 'Drill' })) expect(link).toHaveAttribute('href', '/products/drill')
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(screen.getByText(/SKU: DR-1/)).toBeInTheDocument()
    expect(screen.getByText('₹1,000.00')).toBeInTheDocument()
    expect(screen.getByText('₹1,250.00')).toHaveClass('line-through')
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText('₹2,000.00')).toBeInTheDocument()
    expect(screen.getByAltText('Drill')).toHaveAttribute('src', '/d-t.jpg')
  })

  it('steps the quantity, saves for later and removes', () => {
    const c = parts()
    render(<CartLineRow item={line()} c={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity for Drill' }))
    expect(c.handleQuantityChange).toHaveBeenCalledWith('l1', 3)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity for Drill' }))
    expect(c.handleQuantityChange).toHaveBeenCalledWith('l1', 1)
    fireEvent.click(screen.getByRole('button', { name: 'Save Drill for later' }))
    expect(c.handleSaveForLater).toHaveBeenCalledWith('l1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Drill from cart' }))
    expect(c.handleRemove).toHaveBeenCalledWith('l1')
  })

  it('disables decrease at the minimum, and clamps a typed quantity on blur', () => {
    const c = parts()
    render(<CartLineRow item={line({ quantity: 1 })} c={c} />)
    expect(screen.getByRole('button', { name: 'Decrease quantity for Drill' })).toBeDisabled()
    const field = screen.getByRole('spinbutton')
    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.blur(field)
    expect(field).toHaveValue(1)
    expect(c.handleQuantityChange).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.blur(field)
    expect(c.handleQuantityChange).toHaveBeenCalledWith('l1', 7)
  })

  it('shows a spinner while the line updates', () => {
    render(<CartLineRow item={line()} c={parts({ updatingItems: new Set(['l1']) })} />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Increase quantity for Drill' })).toBeDisabled()
  })

  it('shows a fixed quantity for digital lines and a free entry field for measured units', () => {
    const { unmount } = render(<CartLineRow item={line({ is_digital: true })} c={parts()} />)
    expect(screen.getByText('Qty 1 · Digital')).toBeInTheDocument()
    unmount()
    const c = parts()
    render(<CartLineRow item={line({ quantity: 2, cart_item_unit: { dimension: 'length', display_label: 'm', min_qty: 0.5, qty_step: 0.5, max_qty: 10 } })} c={c} />)
    expect(screen.getByText(/@ ₹100\.00/)).toBeInTheDocument()
    expect(screen.getByText('Min: 0.5 · Max: 10 · Step: 0.5 m')).toBeInTheDocument()
    const field = screen.getByRole('spinbutton')
    fireEvent.change(field, { target: { value: '99' } })
    fireEvent.blur(field)
    expect(c.handleQuantityChange).toHaveBeenCalledWith('l1', 10)
  })

  it('marks unavailable products and shows variant chips and warning badges', () => {
    render(<CartLineRow item={line({ variant: { variant_name: 'Red' }, sub_variant: { sub_variant_name: 'Large' }, products: { ...line().products, is_active: false, fragile: true } })} c={parts()} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('Large')).toBeInTheDocument()
    expect(screen.getByText('Fragile')).toBeInTheDocument()
  })

  it('shows a placeholder icon without a picture', () => {
    const { container } = render(<CartLineRow item={line({ products: { ...line().products, product_images: [] } })} c={parts()} />)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('CartLineCard and CartLineList', () => {
  it('draws the card layout with Save and Remove', () => {
    const c = parts()
    render(<CartLineCard item={line()} c={c} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Drill for later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Drill from cart' }))
    expect(c.handleSaveForLater).toHaveBeenCalledWith('l1')
    expect(c.handleRemove).toHaveBeenCalledWith('l1')
    expect(screen.getByText('₹2,000.00')).toBeInTheDocument()
  })

  it('lists a row per cart line', () => {
    render(<CartLineList c={parts({ cartItems: [line(), line({ id: 'l2', products: { ...line().products, name: 'Saw', slug: 'saw' } })] })} />)
    expect(screen.getAllByRole('link', { name: 'Drill' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Saw' }).length).toBeGreaterThan(0)
  })
})

describe('SavedForLater', () => {
  it('renders nothing when nothing is saved', () => {
    const { container } = render(<SavedForLater c={parts()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists saved items with Move to cart and Remove', () => {
    const c = parts({ savedItems: [line({ id: 's1' })] })
    render(<SavedForLater c={c} />)
    expect(screen.getByRole('heading')).toHaveTextContent('Saved for later (1)')
    fireEvent.click(screen.getByRole('button', { name: 'Move to cart' }))
    expect(c.handleMoveToCart).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Drill from cart' }))
    expect(c.handleRemove).toHaveBeenCalledWith('s1')
  })

  it('disables the buttons while a saved item updates', () => {
    render(<SavedForLater c={parts({ savedItems: [line({ id: 's1' })], updatingItems: new Set(['s1']) })} />)
    expect(screen.getByRole('button', { name: 'Move to cart' })).toBeDisabled()
  })
})

describe('CouponInput', () => {
  it('types an upper-cased code, applies it, and shows errors and offers', () => {
    const c = parts({ couponCode: 'SAVE', couponError: 'Invalid code' })
    render(<CouponInput c={c} />)
    fireEvent.change(screen.getByPlaceholderText('Coupon code'), { target: { value: 'save10' } })
    expect(c.setCouponCode).toHaveBeenCalledWith('SAVE10')
    expect(c.setCouponError).toHaveBeenCalledWith('')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(c.handleApplyCoupon).toHaveBeenCalled()
    expect(screen.getByText('Invalid code')).toBeInTheDocument()
    expect(screen.getByTestId('nudge')).toBeInTheDocument()
    expect(screen.getByTestId('your-coupons')).toBeInTheDocument()
  })

  it('disables Apply with no code, hides the customer\'s coupons for guests', () => {
    render(<CouponInput c={parts({ user: null })} />)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.queryByTestId('your-coupons')).toBeNull()
  })

  it('shows the applied coupon with Remove', () => {
    const c = parts({ appliedCoupon: { code: 'SAVE10', description: '10% off' } })
    render(<CouponInput c={c} />)
    expect(screen.getByText('SAVE10 applied')).toBeInTheDocument()
    expect(screen.getByText('10% off')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(c.handleRemoveCoupon).toHaveBeenCalled()
  })
})

describe('SummaryTotals', () => {
  it('shows subtotal, GST and total', () => {
    render(<SummaryTotals c={parts()} />)
    expect(screen.getByText('Subtotal (2 items)')).toBeInTheDocument()
    expect(screen.getByText('Incl. GST')).toBeInTheDocument()
    expect(screen.getByText('₹305.00')).toBeInTheDocument()
    expect(screen.getByText('Price inclusive of all taxes')).toBeInTheDocument()
  })

  it('shows the coupon discount and savings, and hides GST lines when GST is off', () => {
    render(<SummaryTotals c={parts({ gstEnabled: false, discount: 200, appliedCoupon: { code: 'SAVE10' }, finalTotal: 1800 })} />)
    expect(screen.getByText('Coupon (SAVE10)')).toBeInTheDocument()
    expect(screen.getByText('-₹200.00')).toBeInTheDocument()
    expect(screen.getByText('You save ₹200.00 with this coupon')).toBeInTheDocument()
    expect(screen.getByText('₹1,800.00')).toBeInTheDocument()
    expect(screen.queryByText('Incl. GST')).toBeNull()
  })
})

describe('CheckoutCta', () => {
  it('lets a signed-in shopper proceed, with a custom label', () => {
    const c = parts()
    const { container } = render(<CheckoutCta c={c} label="Pay now" />)
    expect(container.querySelector(`#${SUMMARY_CTA_ID}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Pay now/ }))
    expect(c.proceedToCheckout).toHaveBeenCalled()
  })

  it('blocks checkout while starting, with an empty cart or with unavailable items', () => {
    const { rerender } = render(<CheckoutCta c={parts({ proceedingToCheckout: true })} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveTextContent('Starting…')
    rerender(<CheckoutCta c={parts({ cartCount: 0 })} />)
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<CheckoutCta c={parts({ hasInactiveItems: true })} />)
    expect(screen.getByRole('button')).toHaveTextContent('Remove unavailable items to checkout')
  })

  it('sends a guest to log in or sign up', () => {
    render(<CheckoutCta c={parts({ user: null })} />)
    expect(screen.getByRole('link', { name: /Login to Checkout/ })).toHaveAttribute('href', '/login?redirect=/checkout')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup')
  })

  it('links back to the catalogue', () => {
    render(<ContinueShopping />)
    expect(screen.getByRole('link', { name: 'Continue Shopping' })).toHaveAttribute('href', '/products')
  })
})

describe('CartMobileBar', () => {
  it('renders nothing for an empty cart', () => {
    const { container } = render(<CartMobileBar c={parts({ cartItems: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the item count, total and a Checkout button', () => {
    const c = parts({ cartCount: 1 })
    render(<CartMobileBar c={c} />)
    expect(screen.getByText('Total (1 item)')).toBeInTheDocument()
    expect(screen.getByText('₹2,000.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))
    expect(c.proceedToCheckout).toHaveBeenCalled()
  })

  it('warns about unavailable items and sends guests to log in', () => {
    const { rerender } = render(<CartMobileBar c={parts({ hasInactiveItems: true })} />)
    expect(screen.getByText('Remove unavailable items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled()
    rerender(<CartMobileBar c={parts({ user: null })} />)
    expect(screen.getByRole('link', { name: 'Login to checkout' })).toHaveAttribute('href', '/login?redirect=/checkout')
  })
})
