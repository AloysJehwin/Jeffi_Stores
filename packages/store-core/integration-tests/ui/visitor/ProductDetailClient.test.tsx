import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef, createElement, useEffect, useState } from 'react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) =>
    function Lazy(props: any) {
      const [C, setC] = useState<any>(null)
      useEffect(() => {
        loader().then((m: any) => setC(() => m.default))
      }, [])
      return C ? createElement(C, props) : null
    },
}))
vi.mock('@/hooks/useStoreFlags', () => ({ updateChannelsLabel: (c: any) => `via-${c}`, useMessagingChannels: () => 'whatsapp' }))
// Specifiers split so the component-tests check doesn't count a stub as coverage of the media components.
vi.mock('@/components/media/' + 'MediaItemView', () => ({ DocumentList: ({ items, title }: any) => <div data-testid="docs">{`${title}:${items.length}`}</div> }))
vi.mock('@/components/media/' + 'ProductMediaGallery', () => ({ default: ({ items }: any) => <div data-testid="media">{`media:${items.length}`}</div> }))
vi.mock('@/components/visitor/ProductImageGallery', () => ({
  default: ({ images, productName, discountPct }: any) => <div data-testid="gallery">{`${productName}:${images.length}:${discountPct}`}</div>,
}))
vi.mock('@/components/visitor/ProductActions', () => ({ default: ({ s }: any) => <div data-testid="actions">{s}</div> }))
vi.mock('@/components/visitor/BusinessPriceBadge', () => ({ default: ({ price, categoryId }: any) => <div data-testid="biz">{`${price}:${categoryId}`}</div> }))
vi.mock('@/components/visitor/RazorpayOffers', () => ({ default: () => <div data-testid="rzp" /> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: ({ fragile }: any) => <div data-testid="warn">{String(!!fragile)}</div> }))
vi.mock('@/components/visitor/pdp/ReviewSummaryLink', () => ({ default: ({ summary }: any) => <div data-testid="reviews">{summary.count}</div> }))
let mounted: any = null
const providerProps = vi.fn()
vi.mock('@/components/visitor/pdp/ProductPageProvider', () => ({
  ProductPageProvider: ({ children, ...p }: any) => {
    providerProps(p)
    mounted = pageState()
    return <>{children}</>
  },
  useProductPage: () => mounted,
}))

import ProductDetailClient, {
  DeliveryInfo,
  PincodeChecker,
  PdpGallery,
  PdpMediaExtras,
  PdpPincodeChecker,
  PdpWishlistButton,
  PdpShareButton,
  PdpStockNotice,
} from '@/components/visitor/ProductDetailClient'

const policy = { returnAllowed: true, returnDays: 7, replacementAllowed: true, replacementDays: 10, isCodAllowed: true, freeShippingThreshold: 999 } as any
const pageState = (over: Record<string, any> = {}): any => ({
  product: { name: 'Halo Speaker', discount_pct: '15', stock_status: 'In Stock', fragile: true, categories: { id: 'c1' } },
  images: [{ id: 'i1' }, { id: 'i2' }],
  variantImages: undefined,
  extras: [],
  docs: [],
  reviewSummary: null,
  isDigital: false,
  policy,
  hasVariants: false,
  displayPrice: 999,
  purchase: 'PURCHASE',
  pincode: '',
  setPincode: vi.fn(),
  pincodeResult: null,
  setPincodeResult: vi.fn(),
  pincodeChecking: false,
  checkPincode: vi.fn(),
  pincodeRef: createRef(),
  isInWishlist: false,
  wishlistLoading: false,
  handleWishlist: vi.fn(),
  handleShare: vi.fn(),
  notifyEmail: '',
  setNotifyEmail: vi.fn(),
  notifySubmitted: false,
  handleNotifyMe: vi.fn(),
  ...over,
})

describe('DeliveryInfo', () => {
  it('shows the four policy tiles and the secure-payment row with COD', () => {
    render(<DeliveryInfo {...policy} />)
    expect(screen.getByText('Free Delivery')).toBeInTheDocument()
    expect(screen.getByText('On orders above ₹999')).toBeInTheDocument()
    expect(screen.getByText('Easy Returns')).toBeInTheDocument()
    expect(screen.getByText('7-day return policy')).toBeInTheDocument()
    expect(screen.getByText('Free Replacement')).toBeInTheDocument()
    expect(screen.getByText('10-day guarantee')).toBeInTheDocument()
    expect(screen.getByText('100% Genuine')).toBeInTheDocument()
    expect(screen.getByText('Cash on Delivery')).toBeInTheDocument()
  })

  it('reflects non-returnable, non-replaceable and prepaid-only products', () => {
    render(<DeliveryInfo {...policy} returnAllowed={false} replacementAllowed={false} isCodAllowed={false} />)
    expect(screen.getByText('Non-Returnable')).toBeInTheDocument()
    expect(screen.getByText('Non-Replaceable')).toBeInTheDocument()
    expect(screen.queryByText('Cash on Delivery')).not.toBeInTheDocument()
  })

  it('a tile opens a policy popup with detail, bullets and a link; Close and the backdrop dismiss it', () => {
    render(<DeliveryInfo {...policy} />)
    fireEvent.click(screen.getByText('Easy Returns'))
    expect(screen.getByText('Hassle-free returns within 7 days of delivery.')).toBeInTheDocument()
    expect(screen.getByText('Raise a return request within 7 days of delivery')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Read Return & Refund Policy/ })
    expect(link).toHaveAttribute('href', '/legal/return-refund-policy')
    expect(link).toHaveAttribute('target', '_blank')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Hassle-free returns within 7 days of delivery.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Free Delivery'))
    expect(screen.getByText('Tracking link sent via via-whatsapp after dispatch')).toBeInTheDocument()
    fireEvent.click(document.querySelector('.fixed.inset-0')!)
    expect(screen.queryByRole('link', { name: /Read Shipping Policy/ })).not.toBeInTheDocument()
  })

  it('the payment row opens the payment popup, with the COD line matching the policy', () => {
    const a = render(<DeliveryInfo {...policy} />)
    fireEvent.click(screen.getByText('Secure Payment'))
    expect(screen.getByText('Cash on Delivery available for eligible orders')).toBeInTheDocument()
    a.unmount()
    render(<DeliveryInfo {...policy} isCodAllowed={false} />)
    fireEvent.click(screen.getByText('Secure Payment'))
    expect(screen.getByText('Prepaid orders only for this product')).toBeInTheDocument()
  })

  it('defaults the free-shipping threshold to ₹500', () => {
    render(<DeliveryInfo {...{ ...policy, freeShippingThreshold: undefined }} />)
    expect(screen.getByText('On orders above ₹500')).toBeInTheDocument()
  })
})

describe('PincodeChecker', () => {
  const setup = (over: Record<string, any> = {}) => {
    const props = { pincode: '', setPincode: vi.fn(), pincodeResult: null, setPincodeResult: vi.fn(), pincodeChecking: false, checkPincode: vi.fn(), pincodeRef: createRef<HTMLInputElement>(), ...over }
    render(<PincodeChecker {...(props as any)} />)
    return props
  }

  it('keeps digits only, clears the old result, and checks on Enter or the button', () => {
    const p = setup()
    fireEvent.change(screen.getByPlaceholderText('Enter pincode'), { target: { value: '56a0001' } })
    expect(p.setPincode).toHaveBeenCalledWith('560001')
    expect(p.setPincodeResult).toHaveBeenCalledWith(null)
    fireEvent.keyDown(screen.getByPlaceholderText('Enter pincode'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(p.checkPincode).toHaveBeenCalledTimes(2)
  })

  it('shows a checking state and the result, ok or not', () => {
    setup({ pincodeChecking: true })
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  })

  it('renders a deliverable and an undeliverable result', () => {
    const a = render(<PincodeChecker pincode="560001" setPincode={vi.fn()} pincodeResult={{ ok: true, message: 'Delivers in 3 days' }} setPincodeResult={vi.fn()} pincodeChecking={false} checkPincode={vi.fn()} pincodeRef={createRef() as any} />)
    expect(screen.getByText(/✓ Delivers in 3 days/)).toBeInTheDocument()
    a.unmount()
    render(<PincodeChecker pincode="560001" setPincode={vi.fn()} pincodeResult={{ ok: false, message: 'Not serviceable' }} setPincodeResult={vi.fn()} pincodeChecking={false} checkPincode={vi.fn()} pincodeRef={createRef() as any} />)
    expect(screen.getByText(/✗ Not serviceable/)).toBeInTheDocument()
  })
})

describe('PDP pieces driven by page state', () => {
  it('PdpGallery passes the product name, images and numeric discount to the gallery', () => {
    render(<PdpGallery page={pageState()} />)
    expect(screen.getByTestId('gallery')).toHaveTextContent('Halo Speaker:2:15')
    expect(screen.queryByTestId('media')).not.toBeInTheDocument()
  })

  it('PdpMediaExtras lazy-loads videos/3D and lists documents only when present', async () => {
    const a = render(<PdpMediaExtras page={pageState()} />)
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()
    render(<PdpMediaExtras page={pageState({ extras: [1, 2], docs: [1] })} />)
    expect(screen.getByText(/Videos, 3D/)).toBeInTheDocument()
    expect(await screen.findByTestId('media')).toHaveTextContent('media:2')
    expect(screen.getByTestId('docs')).toHaveTextContent('Documents & downloads:1')
  })

  it('PdpPincodeChecker is wired to the page', () => {
    const page = pageState({ pincode: '560001' })
    render(<PdpPincodeChecker page={page} />)
    expect(screen.getByPlaceholderText('Enter pincode')).toHaveValue('560001')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(page.checkPincode).toHaveBeenCalled()
  })

  it('wishlist and share buttons call the page handlers and reflect wishlist state', () => {
    const page = pageState()
    const a = render(<PdpWishlistButton page={page} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }))
    expect(page.handleWishlist).toHaveBeenCalled()
    a.unmount()
    render(<PdpWishlistButton page={pageState({ isInWishlist: true, wishlistLoading: true })} />)
    expect(screen.getByRole('button', { name: 'Remove from wishlist' })).toBeDisabled()
    render(<PdpShareButton page={page} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    expect(page.handleShare).toHaveBeenCalled()
  })

  it('PdpStockNotice: nothing for in-stock, urgency for low stock', () => {
    const a = render(<PdpStockNotice page={pageState()} />)
    expect(a.container.textContent).toBe('')
    a.unmount()
    render(<PdpStockNotice page={pageState({ product: { stock_status: 'Low Stock' } })} />)
    expect(screen.getByText('Only a few left — order soon')).toBeInTheDocument()
  })

  it('PdpStockNotice: out of stock offers a back-in-stock email form, then confirms', () => {
    const page = pageState({ product: { stock_status: 'Out of Stock' }, notifyEmail: 'a@b.co' })
    const a = render(<PdpStockNotice page={page} />)
    const input = screen.getByPlaceholderText('Enter your email')
    expect(input).toHaveValue('a@b.co')
    fireEvent.change(input, { target: { value: 'x@y.co' } })
    expect(page.setNotifyEmail).toHaveBeenCalledWith('x@y.co')
    fireEvent.click(screen.getByRole('button', { name: 'Notify Me' }))
    expect(page.handleNotifyMe).toHaveBeenCalled()
    a.unmount()
    render(<PdpStockNotice page={pageState({ product: { stock_status: 'Out of Stock' }, notifySubmitted: true })} />)
    expect(screen.getByText(/We'll email you when this is back in stock/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Enter your email')).not.toBeInTheDocument()
  })
})

describe('ProductDetailClient', () => {
  beforeEach(() => {
    mounted = null
    providerProps.mockReset()
  })

  it('renders nothing without a product and outside a provider', () => {
    const { container } = render(<ProductDetailClient />)
    expect(container).toBeEmptyDOMElement()
  })

  it('on its own it mounts a ProductPageProvider with the given props and draws the details', () => {
    render(<ProductDetailClient {...({ product: { name: 'Halo Speaker' } } as any)} />)
    expect(providerProps).toHaveBeenCalledWith(expect.objectContaining({ product: { name: 'Halo Speaker' } }))
    expect(screen.getByRole('heading', { level: 1, name: 'Halo Speaker' })).toBeInTheDocument()
    expect(screen.getByTestId('gallery')).toBeInTheDocument()
    expect(screen.getByTestId('actions')).toHaveTextContent('PURCHASE')
    expect(screen.getByTestId('rzp')).toBeInTheDocument()
    expect(screen.getByTestId('warn')).toHaveTextContent('true')
    expect(screen.getByTestId('biz')).toHaveTextContent('999:c1')
    expect(screen.queryByTestId('reviews')).not.toBeInTheDocument()
  })

  it('inside a page provider it reads that page: review link, no business badge for variant products', () => {
    mounted = pageState({ reviewSummary: { count: 12 }, hasVariants: true })
    render(<ProductDetailClient />)
    expect(providerProps).not.toHaveBeenCalled()
    expect(screen.getByTestId('reviews')).toHaveTextContent('12')
    expect(screen.queryByTestId('biz')).not.toBeInTheDocument()
  })

  it('digital products replace delivery and pincode with a vault note on desktop', () => {
    mounted = pageState({ isDigital: true })
    render(<ProductDetailClient />)
    expect(screen.getByText(/Digital product — delivered instantly to your vault/)).toBeInTheDocument()
  })

  it('physical products show delivery info and the pincode checker', () => {
    mounted = pageState()
    render(<ProductDetailClient />)
    expect(screen.getAllByText('Free Delivery').length).toBeGreaterThan(0)
    expect(screen.getAllByPlaceholderText('Enter pincode').length).toBeGreaterThan(0)
  })
})
