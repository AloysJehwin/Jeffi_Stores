import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const m = vi.hoisted(() => ({ page: null as any }))

vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('@/components/visitor/ProductImageGallery', () => ({
  default: ({ productName, discountPct }: any) => <div data-testid="plain-gallery" data-name={productName} data-discount={String(discountPct)} />,
  Lightbox: ({ index, onIndex, onClose }: any) => (
    <div role="dialog" data-index={index}>
      <button onClick={() => onIndex(index + 1)}>next</button>
      <button onClick={onClose}>close lightbox</button>
    </div>
  ),
}))
vi.mock('@/components/visitor/ProductDetailClient', () => ({
  DeliveryInfo: () => <div data-testid="delivery-info" />,
  PdpGallery: () => <div data-testid="pdp-gallery" />,
  PdpMediaExtras: () => <div data-testid="media-extras" />,
  PdpPincodeChecker: () => <div data-testid="pincode" />,
  PdpShareButton: () => <button>share</button>,
  PdpWishlistButton: () => <button>wishlist</button>,
}))
vi.mock('@/components/visitor/ProductActions', () => ({
  BuyNowButton: ({ label }: any) => <button>{label ?? 'Buy now'}</button>,
  PurchaseButtons: ({ addLabel, viewCart, buyNow }: any) => <div data-testid="buttons" data-add={addLabel ?? ''} data-viewcart={String(viewCart)} data-buynow={buyNow} />,
  PurchaseNotices: () => <div data-testid="notices" />,
  PurchaseOptions: ({ style }: any) => <div data-testid="options" data-style={style} />,
  PurchasePrice: ({ compact }: any) => <div data-testid="price" data-compact={String(compact)} />,
  PurchaseQuantity: ({ stock }: any) => <div data-testid="quantity" data-stock={String(stock)} />,
  PurchaseStickyBar: () => <div data-testid="sticky" />,
  PurchaseSubscribe: () => <div data-testid="subscribe" />,
}))
vi.mock('@/components/visitor/pdp/ReviewSummaryLink', () => ({ default: ({ summary }: any) => <a href="#reviews">{summary.count} reviews</a> }))
vi.mock('@/components/visitor/pdp/ProductPageProvider', () => ({ useProductPage: () => m.page }))

import {
  ProductGalleryPart,
  ProductPricePart,
  ProductRatingPart,
  VariantPickerPart,
  QuantityPickerPart,
  AddToCartPart,
  BuyNowPart,
  WishlistButtonPart,
  DeliveryCheckPart,
} from '@/components/visitor/site/code/parts/product/pieces'

const page = (over: any = {}) => ({
  product: { name: 'Drill', discount_pct: '15' },
  images: [{ id: 'i1', image_url: '/a.jpg', blurhash: null }, { id: 'i2', image_url: '/b.jpg', blurhash: null }, { id: 'i3', image_url: '/c.jpg', blurhash: null }],
  variantImages: [],
  purchase: { hasVariants: true, digital: false, alreadyOwned: false, subscribing: false },
  reviewSummary: { count: 8 },
  isDigital: false,
  policy: {},
  ...over,
})

beforeEach(() => {
  m.page = page()
})

describe('every product part', () => {
  it('renders nothing outside a product page', () => {
    m.page = null
    const parts = [
      <ProductGalleryPart key="g" />, <ProductPricePart key="p" />, <ProductRatingPart key="r" />, <VariantPickerPart key="v" />, <QuantityPickerPart key="q" />,
      <AddToCartPart key="a" />, <BuyNowPart key="b" />, <WishlistButtonPart key="w" />, <DeliveryCheckPart key="d" />,
    ]
    for (const part of parts) {
      const { container, unmount } = render(part)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })
})

describe('ProductGalleryPart', () => {
  it('draws the media gallery as a carousel by default, or the plain one without media', () => {
    const { rerender } = render(<ProductGalleryPart />)
    expect(screen.getByTestId('pdp-gallery')).toBeInTheDocument()
    rerender(<ProductGalleryPart media={false} />)
    expect(screen.getByTestId('plain-gallery')).toHaveAttribute('data-discount', '15')
    expect(screen.getByTestId('plain-gallery')).toHaveAttribute('data-name', 'Drill')
  })

  it('lists the pictures in a grid or stack, and opens the lightbox on click', () => {
    const { container } = render(<ProductGalleryPart layout="grid" />)
    expect(container.querySelector('.grid-cols-2')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByAltText('Drill - Image 2')).toHaveAttribute('src', '/b.jpg')
    expect(screen.getByTestId('media-extras')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button')[1])
    expect(screen.getByRole('dialog')).toHaveAttribute('data-index', '1')
    fireEvent.click(screen.getByText('next'))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-index', '2')
    fireEvent.click(screen.getByText('close lightbox'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses the selected variant\'s pictures when it has them, and no extras with media off', () => {
    m.page = page({ variantImages: [{ id: 'v1', image_url: '/v.jpg', blurhash: null }] })
    const { container } = render(<ProductGalleryPart layout="stacked" media={false} />)
    expect(container.querySelector('.flex-col')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByAltText('Drill - Image 1')).toHaveAttribute('src', '/v.jpg')
    expect(screen.queryByTestId('media-extras')).toBeNull()
  })
})

describe('price, rating, options, quantity', () => {
  it('draws the price, compact when asked', () => {
    render(<ProductPricePart size="compact" />)
    expect(screen.getByTestId('price')).toHaveAttribute('data-compact', 'true')
  })

  it('links the review summary only when there are reviews', () => {
    const { container, rerender } = render(<ProductRatingPart />)
    expect(screen.getByRole('link', { name: '8 reviews' })).toBeInTheDocument()
    m.page = page({ reviewSummary: null })
    rerender(<ProductRatingPart />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the variant picker only for products with variants', () => {
    const { container, rerender } = render(<VariantPickerPart style="dropdown" />)
    expect(screen.getByTestId('options')).toHaveAttribute('data-style', 'dropdown')
    m.page = page({ purchase: { hasVariants: false } })
    rerender(<VariantPickerPart />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the quantity picker with stock text on by default', () => {
    const { rerender } = render(<QuantityPickerPart />)
    expect(screen.getByTestId('quantity')).toHaveAttribute('data-stock', 'true')
    rerender(<QuantityPickerPart stock={false} />)
    expect(screen.getByTestId('quantity')).toHaveAttribute('data-stock', 'false')
  })
})

describe('AddToCartPart / BuyNowPart', () => {
  it('draws notices, subscribe, buttons and the sticky bar', () => {
    render(<AddToCartPart label="Add it" viewCart={false} />)
    for (const id of ['notices', 'subscribe', 'sticky']) expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(screen.getByTestId('buttons')).toHaveAttribute('data-add', 'Add it')
    expect(screen.getByTestId('buttons')).toHaveAttribute('data-viewcart', 'false')
    expect(screen.getByTestId('buttons')).toHaveAttribute('data-buynow', 'digital')
  })

  it('leaves out the sticky bar when asked', () => {
    render(<AddToCartPart sticky={false} />)
    expect(screen.queryByTestId('sticky')).toBeNull()
  })

  it('draws Buy now, but not for digital, owned or subscription purchases', () => {
    const { container, rerender } = render(<BuyNowPart label="Buy it now" />)
    expect(screen.getByRole('button', { name: 'Buy it now' })).toBeInTheDocument()
    for (const flag of ['digital', 'alreadyOwned', 'subscribing']) {
      m.page = page({ purchase: { [flag]: true } })
      rerender(<BuyNowPart />)
      expect(container).toBeEmptyDOMElement()
    }
  })
})

describe('WishlistButtonPart', () => {
  it('draws the wishlist button, with share when asked', () => {
    const { rerender } = render(<WishlistButtonPart />)
    expect(screen.getByRole('button', { name: 'wishlist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share' })).toBeNull()
    rerender(<WishlistButtonPart share />)
    expect(screen.getByRole('button', { name: 'share' })).toBeInTheDocument()
  })
})

describe('DeliveryCheckPart', () => {
  it('draws delivery policies and the pincode checker', () => {
    const { rerender } = render(<DeliveryCheckPart />)
    expect(screen.getByTestId('delivery-info')).toBeInTheDocument()
    expect(screen.getByTestId('pincode')).toBeInTheDocument()
    rerender(<DeliveryCheckPart policies={false} />)
    expect(screen.queryByTestId('delivery-info')).toBeNull()
  })

  it('says digital products are delivered instantly instead of checking pincodes', () => {
    m.page = page({ isDigital: true })
    render(<DeliveryCheckPart />)
    expect(screen.getByText(/delivered instantly to your vault/)).toBeInTheDocument()
    expect(screen.queryByTestId('pincode')).toBeNull()
  })
})
