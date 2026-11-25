import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <span data-testid="copy-sku" /> }))
vi.mock('@/components/visitor/cart/MobileCheckoutBar', () => ({
  default: ({ label, amount, children }: any) => (
    <div data-testid="mobile-bar">
      <span>{label}</span>
      <span>{amount}</span>
      {children}
    </div>
  ),
}))
vi.mock('@/components/payments', () => ({
  PaymentSections: ({ value, onChange, upi, razorpay, cod }: any) => (
    <div data-testid="payments" data-value={value} data-opts={[upi && 'upi', razorpay && 'razorpay', cod && 'cod'].filter(Boolean).join(',')}>
      <button onClick={() => onChange('cod')}>choose cod</button>
    </div>
  ),
  UpiManualDialog: ({ onConfirm, onClose, error }: any) => (
    <div role="dialog">
      <span>{error}</span>
      <button onClick={() => onConfirm('UTR123')}>confirm utr</button>
      <button onClick={onClose}>close upi</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/site/code/parts/checkout/context', () => ({}))

import {
  CheckoutError,
  OrderItemsList,
  DeliveryAddress,
  OrderNotes,
  PaymentMethod,
  TrustStrip,
  SummaryLines,
  StoreContact,
  PlaceOrderButton,
  BackToReview,
  CheckoutMobileBar,
  CheckoutUpiDialog,
} from '@/components/visitor/site/code/parts/checkout/pieces'

const cartLine = (over: any = {}) => ({
  id: 'l1',
  quantity: 2,
  price_at_addition: 100,
  buy_mode: 'unit',
  buy_unit: null,
  variant: null,
  sub_variant: null,
  products: { name: 'Drill', base_price: 1000, mrp: 1250, sku: 'DR-1', brand_name: 'Bosch', product_images: [{ is_primary: true, image_url: '/d.jpg', thumbnail_url: '/d-t.jpg' }] },
  ...over,
})

const parts = (over: any = {}): any => ({
  error: '',
  existingOrder: null,
  handleCancelPreviousOrder: vi.fn(),
  isCancellingPrevious: false,
  isBuyNow: false,
  buyNowItem: null,
  cartItems: [cartLine()],
  gstEnabled: true,
  address: { full_name: 'Asha K', address_line1: '12 MG Road', address_line2: 'Flat 4', landmark: 'Near park', city: 'Pune', state: 'MH', postal_code: '411001', phone: '9876543210' },
  notes: '',
  setNotes: vi.fn(),
  finalTotal: 2305,
  upiEnabled: true,
  isRazorpayEnabled: true,
  codAvailable: false,
  paymentMethod: 'razorpay',
  choosePayment: vi.fn(),
  noPaymentMethod: false,
  serviceable: true,
  cartCount: 2,
  subtotal: 2000,
  tax: 305,
  couponCode: null,
  discountAmount: 0,
  shippingCharge: null,
  codFee: 0,
  storeIdentity: { phone: '+91 98765 43210', email: 'help@store.test' },
  submitDisabled: false,
  isSubmitting: false,
  isOnlinePay: true,
  upi: { manual: { id: 'm' }, busy: false, error: 'UTR invalid', confirmUtr: vi.fn(), dismissManual: vi.fn() },
  setIsSubmitting: vi.fn(),
  ...over,
})

describe('CheckoutError', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<CheckoutError c={parts()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the message, and offers the pending order and its cancellation', () => {
    const c = parts({ error: 'You have a pending order', existingOrder: { id: 'o9', orderNumber: 'ORD-9' } })
    render(<CheckoutError c={c} />)
    expect(screen.getByText('You have a pending order')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Order #ORD-9' })).toHaveAttribute('href', '/account/orders/o9')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Previous Order' }))
    expect(c.handleCancelPreviousOrder).toHaveBeenCalled()
  })

  it('disables the cancel button while cancelling', () => {
    render(<CheckoutError c={parts({ error: 'x', existingOrder: { id: 'o', orderNumber: '1' }, isCancellingPrevious: true })} />)
    expect(screen.getByRole('button', { name: 'Cancelling...' })).toBeDisabled()
  })
})

describe('OrderItemsList', () => {
  it('lists cart lines with price, quantity, MRP discount and total', () => {
    render(<OrderItemsList c={parts({ cartItems: [cartLine({ variant: { variant_name: 'Red' }, sub_variant: { sub_variant_name: 'XL' } })] })} />)
    expect(screen.getByRole('heading', { name: 'Drill' })).toBeInTheDocument()
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(screen.getByText(/SKU: DR-1/)).toBeInTheDocument()
    expect(screen.getByText('Red')).toBeInTheDocument()
    expect(screen.getByText('XL')).toBeInTheDocument()
    expect(screen.getByText('₹2,000.00')).toBeInTheDocument()
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByAltText('Drill')).toHaveAttribute('src', '/d-t.jpg')
  })

  it('shows measured lines with their unit and the price at addition', () => {
    render(<OrderItemsList c={parts({ cartItems: [cartLine({ buy_mode: 'length', buy_unit: 'm', quantity: '2.5' })] })} />)
    expect(screen.getByText(/× 2\.5/)).toBeInTheDocument()
    expect(screen.getByText('₹250.00')).toBeInTheDocument()
  })

  it('uses the ex-GST price when GST is off', () => {
    render(<OrderItemsList c={parts({ gstEnabled: false, cartItems: [cartLine({ products: { ...cartLine().products, price_ex_gst: 847.46, mrp: null } })] })} />)
    expect(screen.getByText('₹1,694.92')).toBeInTheDocument()
  })

  it('shows a placeholder when a line has no picture', () => {
    const { container } = render(<OrderItemsList c={parts({ cartItems: [cartLine({ products: { ...cartLine().products, product_images: [] } })] })} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the buy-now item with GST, instead of the cart', () => {
    const buyNowItem = { productName: 'Saw', imageUrl: '/s.jpg', brandName: 'Makita', sku: 'SW-1', variantName: 'Blue', subVariantName: null, price: 500, mrp: 625, qty: 3, buyMode: 'unit', buyUnit: null, gstPercentage: 18 }
    render(<OrderItemsList c={parts({ isBuyNow: true, buyNowItem })} />)
    expect(screen.getByRole('heading', { name: 'Saw' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Drill' })).toBeNull()
    expect(screen.getByText('₹1,500.00')).toBeInTheDocument()
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText(/GST @/)).toHaveTextContent('18%')
  })
})

describe('DeliveryAddress / OrderNotes', () => {
  it('shows the address, landmark and phone with a link back to review', () => {
    render(<DeliveryAddress c={parts()} />)
    expect(screen.getByText('Asha K')).toBeInTheDocument()
    expect(screen.getByText('Flat 4')).toBeInTheDocument()
    expect(screen.getByText('Landmark: Near park')).toBeInTheDocument()
    expect(screen.getByText('Pune, MH 411001')).toBeInTheDocument()
    expect(screen.getByText('Phone: 9876543210')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/checkout/review')
  })

  it('omits the optional address lines', () => {
    render(<DeliveryAddress c={parts({ address: { full_name: 'B', address_line1: 'x', city: 'c', state: 's', postal_code: '1', phone: '2' } })} />)
    expect(screen.queryByText(/Landmark/)).toBeNull()
  })

  it('edits the order notes', () => {
    const c = parts()
    render(<OrderNotes c={c} />)
    fireEvent.change(screen.getByPlaceholderText(/special instructions/), { target: { value: 'Leave at gate' } })
    expect(c.setNotes).toHaveBeenCalledWith('Leave at gate')
  })
})

describe('PaymentMethod', () => {
  it('passes the available methods and selection to the payment sections', () => {
    const c = parts({ codAvailable: true })
    render(<PaymentMethod c={c} />)
    expect(screen.getByTestId('payments')).toHaveAttribute('data-opts', 'upi,razorpay,cod')
    expect(screen.getByTestId('payments')).toHaveAttribute('data-value', 'razorpay')
    fireEvent.click(screen.getByText('choose cod'))
    expect(c.choosePayment).toHaveBeenCalledWith('cod')
  })

  it('explains when no method is possible or the pincode is not serviceable', () => {
    render(<PaymentMethod c={parts({ noPaymentMethod: true, serviceable: false })} />)
    expect(screen.getByText('No payment method is available for this cart.')).toBeInTheDocument()
    expect(screen.getByText(/Delivery is not available to this pincode/)).toBeInTheDocument()
  })
})

describe('TrustStrip', () => {
  it('shows the four reassurance badges', () => {
    render(<TrustStrip />)
    for (const t of ['Secure Checkout', 'Easy Returns', 'Genuine Products', '24×7 Support']) expect(screen.getByText(t)).toBeInTheDocument()
  })
})

describe('SummaryLines', () => {
  it('shows subtotal, GST, delivery and the total', () => {
    render(<SummaryLines c={parts({ shippingCharge: 0 })} />)
    expect(screen.getByText('Subtotal (2 items)')).toBeInTheDocument()
    expect(screen.getByText('₹305.00')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('₹2,305.00')).toBeInTheDocument()
  })

  it('shows a charged delivery, coupon and the COD fee only for cash on delivery', () => {
    const { rerender } = render(<SummaryLines c={parts({ shippingCharge: 80, couponCode: 'SAVE10', discountAmount: 200, codFee: 50, paymentMethod: 'cod' })} />)
    expect(screen.getByText('₹80.00')).toBeInTheDocument()
    expect(screen.getByText('Coupon (SAVE10)')).toBeInTheDocument()
    expect(screen.getByText(/200\.00/)).toBeInTheDocument()
    expect(screen.getByText('COD handling fee')).toBeInTheDocument()
    rerender(<SummaryLines c={parts({ codFee: 50, paymentMethod: 'razorpay' })} />)
    expect(screen.queryByText('COD handling fee')).toBeNull()
  })

  it('leaves the count and GST out for a buy-now order', () => {
    render(<SummaryLines c={parts({ isBuyNow: true })} />)
    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.queryByText('Incl. GST')).toBeNull()
  })
})

describe('StoreContact', () => {
  it('links the phone and email', () => {
    render(<StoreContact c={parts()} />)
    expect(screen.getByRole('link', { name: /98765 43210/ })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByRole('link', { name: /help@store.test/ })).toHaveAttribute('href', 'mailto:help@store.test')
  })

  it('says details are coming when the store has none', () => {
    render(<StoreContact c={parts({ storeIdentity: { phone: null, email: null } })} />)
    expect(screen.getByText('Contact details coming soon.')).toBeInTheDocument()
  })
})

describe('PlaceOrderButton / CheckoutMobileBar', () => {
  it('words the button by payment: pay, pay on delivery, or place order', () => {
    const { rerender } = render(<PlaceOrderButton c={parts()} />)
    expect(screen.getByRole('button')).toHaveTextContent('Pay ₹2,305.00')
    rerender(<PlaceOrderButton c={parts({ isOnlinePay: false, paymentMethod: 'cod' })} />)
    expect(screen.getByRole('button')).toHaveTextContent('Place Order — Pay on Delivery')
    rerender(<PlaceOrderButton c={parts({ isOnlinePay: false, paymentMethod: 'upi' })} />)
    expect(screen.getByRole('button')).toHaveTextContent(/^Place Order$/)
  })

  it('shows progress and disables when submitting or not ready', () => {
    const { rerender } = render(<PlaceOrderButton c={parts({ isSubmitting: true })} />)
    expect(screen.getByRole('button')).toHaveTextContent('Processing...')
    rerender(<PlaceOrderButton c={parts({ isSubmitting: true, isOnlinePay: false })} />)
    expect(screen.getByRole('button')).toHaveTextContent('Placing Order...')
    rerender(<PlaceOrderButton c={parts({ submitDisabled: true })} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows a notice instead of the button when orders cannot be accepted', () => {
    render(<PlaceOrderButton c={parts({ noPaymentMethod: true })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/unable to accept orders right now/)).toBeInTheDocument()
  })

  it('has a link back to review', () => {
    render(<BackToReview />)
    expect(screen.getByRole('link', { name: /Back to Review/ })).toHaveAttribute('href', '/checkout/review')
  })

  it('mobile bar shows the total and a submit button worded by payment', () => {
    const { rerender } = render(<CheckoutMobileBar c={parts()} />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('₹2,305.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeEnabled()
    rerender(<CheckoutMobileBar c={parts({ paymentMethod: 'cod', isOnlinePay: false })} />)
    expect(screen.getByText('Total · Pay on delivery')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order' })).toBeInTheDocument()
    rerender(<CheckoutMobileBar c={parts({ isSubmitting: true })} />)
    expect(screen.getByRole('button', { name: 'Placing…' })).toBeInTheDocument()
  })

  it('mobile bar is absent without a payment method', () => {
    const { container } = render(<CheckoutMobileBar c={parts({ noPaymentMethod: true })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CheckoutUpiDialog', () => {
  it('confirms the UTR and, when dismissed, stops the submitting state', () => {
    const c = parts()
    render(<CheckoutUpiDialog c={c} />)
    expect(screen.getByText('UTR invalid')).toBeInTheDocument()
    fireEvent.click(screen.getByText('confirm utr'))
    expect(c.upi.confirmUtr).toHaveBeenCalledWith('UTR123')
    fireEvent.click(screen.getByText('close upi'))
    expect(c.upi.dismissManual).toHaveBeenCalled()
    expect(c.setIsSubmitting).toHaveBeenCalledWith(false)
  })
})
