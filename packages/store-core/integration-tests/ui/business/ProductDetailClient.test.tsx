import React, { Suspense } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<any>) => {
    const Lazy = React.lazy(loader)
    return (p: any) => (
      <Suspense fallback={null}>
        <Lazy {...p} />
      </Suspense>
    )
  },
}))
vi.mock('@/components/media/ProductMediaGallery', () => ({ default: ({ items }: any) => <div data-testid="media-gallery">{items.length} extras</div> }))
vi.mock('@/components/media/MediaItemView', () => ({ DocumentList: ({ items, title }: any) => <div data-testid="docs">{title}: {items.length}</div> }))
vi.mock('@/components/visitor/ProductImageGallery', () => ({
  default: ({ images, ribbonLabel, discountPct, variantImages }: any) => (
    <div data-testid="gallery" data-count={images.length} data-ribbon={ribbonLabel ?? ''} data-discount={String(discountPct)} data-variant-imgs={variantImages ? variantImages.length : ''} />
  ),
}))
let actionsProps: any
vi.mock('@/components/business/ProductActions', () => ({
  default: (p: any) => {
    actionsProps = p
    return (
      <div data-testid="actions" data-price={p.basePrice} data-handling={p.handlingDays}>
        <button onClick={() => p.onSelectionChange('v1', 'sv1')}>select-variant</button>
        <button onClick={() => p.onVariantChange({ variant_images: [{ id: 'i' }] })}>variant-images</button>
        <button onClick={() => p.onVariantChange(null)}>variant-none</button>
        <button onClick={() => p.onUnitChange('Box', 'Box of 6', { min: 2, max: 10, step: 2, factor: 6, dimension: 'count' })}>pick-unit</button>
      </div>
    )
  },
}))
let quoteProps: any
vi.mock('@/components/business/RequestQuoteButton', () => ({
  default: (p: any) => {
    quoteProps = p
    return <div data-testid="quote" />
  },
}))
vi.mock('@/components/visitor/RazorpayOffers', () => ({ default: () => <div>razorpay-offers</div> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: ({ fragile }: any) => (fragile ? <span>fragile-badge</span> : null) }))
const auth: { user: any } = { user: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const flags = { gstEnabled: true, digitalProductsEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import ProductDetailClient from '@/components/business/ProductDetailClient'

const baseProduct = (over: Record<string, any> = {}): any => ({
  id: 'p1',
  name: 'Halo Headphones',
  sku: 'HALO-1',
  slug: 'halo',
  base_price: 1000,
  price_ex_gst: 847.46,
  mrp: 1250,
  gst_percentage: 18,
  stock_status: 'In Stock',
  has_variants: false,
  product_images: [{ id: 'i1', image_url: '/a.jpg', thumbnail_url: '/a-t.jpg', is_primary: true }],
  product_variants: [],
  categories: { id: 'c1', name: 'Audio', slug: 'audio' },
  brands: { id: 'b1', name: 'Halo', slug: 'halo' },
  ...over,
})

describe('business ProductDetailClient', () => {
  beforeEach(() => {
    auth.user = null
    flags.gstEnabled = true
    flags.digitalProductsEnabled = true
    window.scrollTo = vi.fn() as any
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
  })

  it('shows the product, wires the purchase panel and quote button, and records a business view', () => {
    render(<ProductDetailClient product={baseProduct()} />)
    expect(screen.getByRole('heading', { name: 'Halo Headphones' })).toBeInTheDocument()
    expect(screen.getByTestId('actions')).toHaveAttribute('data-price', '1000')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-count', '1')
    expect(screen.getByText('razorpay-offers')).toBeInTheDocument()
    expect(quoteProps.items[0]).toMatchObject({ productId: 'p1', description: 'Halo Headphones', currentPrice: 1000, sku: 'HALO-1', stockStatus: 'in', brandName: 'Halo', categoryName: 'Audio' })
    expect(fetch).toHaveBeenCalledWith('/api/products/p1/view', expect.objectContaining({ method: 'POST', headers: { 'X-Auth-Portal': 'business' } }))
    expect(window.scrollTo).toHaveBeenCalled()
  })

  it('shows the delivery, return, replacement and genuine promises, and COD when allowed', () => {
    render(<ProductDetailClient product={baseProduct({ is_cod_allowed: true })} freeShippingThreshold={2500} />)
    expect(screen.getAllByText('Free Delivery').length).toBeGreaterThan(0)
    expect(screen.getAllByText('On orders above ₹2,500').length).toBeGreaterThan(0)
    expect(screen.getAllByText('100% Genuine').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cash on Delivery').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Secure Payment').length).toBeGreaterThan(0)
  })

  it('shows non-returnable and non-replaceable when the brand says so', () => {
    render(<ProductDetailClient product={baseProduct({ brands: { id: 'b1', name: 'Halo', slug: 'halo', return_allowed: false, replacement_allowed: false } })} />)
    expect(screen.getAllByText('Non-Returnable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Non-Replaceable').length).toBeGreaterThan(0)
  })

  it('hides delivery promises for digital products', () => {
    render(<ProductDetailClient product={baseProduct({ is_digital: true })} />)
    expect(screen.queryByText('Free Delivery')).toBeNull()
  })

  it('prices off the ex-GST amount when GST is off and strips GST from the MRP', () => {
    flags.gstEnabled = false
    render(<ProductDetailClient product={baseProduct()} />)
    expect(Number(screen.getByTestId('actions').getAttribute('data-price'))).toBeCloseTo(847.46, 1)
  })

  it('gives approved business buyers their category discount and a Business offer ribbon', () => {
    auth.user = { isBusiness: true, approvalStatus: 'approved', businessDiscountMap: { c1: 10 } }
    render(<ProductDetailClient product={baseProduct({ discount_pct: 5 })} />)
    expect(screen.getByTestId('actions')).toHaveAttribute('data-price', '900')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-ribbon', 'Business offer')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-discount', 'null')
    expect(quoteProps.items[0].businessDiscountPct).toBe(10)
  })

  it('ignores the discount for buyers who are not approved', () => {
    auth.user = { isBusiness: true, approvalStatus: 'pending', businessDiscountMap: { c1: 10 } }
    render(<ProductDetailClient product={baseProduct({ discount_pct: 5 })} />)
    expect(screen.getByTestId('actions')).toHaveAttribute('data-price', '1000')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-discount', '5')
    expect(quoteProps.items[0].businessDiscountPct).toBeUndefined()
  })

  it('uses the longer of handling days and lead time', () => {
    render(<ProductDetailClient product={baseProduct({ handling_days: 2, lead_time_days: 9 })} />)
    expect(screen.getByTestId('actions')).toHaveAttribute('data-handling', '9')
  })

  it('passes variants to the quote button instead of a fixed price when the product has variants', () => {
    const variants = [{ id: 'v1', variant_name: 'Black', sku: 'H-B', price: 1000, stock_status: 'In Stock' }]
    render(<ProductDetailClient product={baseProduct({ has_variants: true, product_variants: variants })} />)
    expect(quoteProps.items[0]).toMatchObject({ currentPrice: null, sku: null, variants })
    expect(actionsProps.variants).toEqual(variants)
  })

  it('tracks the chosen variant, sub-variant and unit for the quote', () => {
    render(<ProductDetailClient product={baseProduct()} />)
    fireEvent.click(screen.getByText('select-variant'))
    fireEvent.click(screen.getByText('pick-unit'))
    expect(quoteProps.items[0]).toMatchObject({ variantId: 'v1', subVariantId: 'sv1', unit: 'Box', unitMin: 2, unitMax: 10, unitStep: 2, unitFactor: 6 })
  })

  it('swaps gallery images for a variant that has its own, and back', () => {
    render(<ProductDetailClient product={baseProduct()} />)
    fireEvent.click(screen.getByText('variant-images'))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-variant-imgs', '1')
    fireEvent.click(screen.getByText('variant-none'))
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-variant-imgs', '')
  })

  it('shows extra media and downloadable documents beneath the gallery', async () => {
    const m = { thumbnail_url: null, metadata: {}, product_id: 'p1', variant_id: null, sub_variant_id: null }
    const media = [
      { ...m, id: 'm1', kind: 'image', url: '/a.jpg', is_primary: true, sort_order: 0 },
      { ...m, id: 'm2', kind: 'video', url: '/v.mp4', is_primary: false, sort_order: 1 },
      { ...m, id: 'm3', kind: 'document', url: '/d.pdf', is_primary: false, sort_order: 2 },
    ]
    render(<ProductDetailClient product={baseProduct({ media })} />)
    expect(await screen.findByTestId('media-gallery')).toHaveTextContent('1 extras')
    expect(screen.getByTestId('docs')).toHaveTextContent('Documents & downloads: 1')
    expect(screen.getByTestId('gallery')).toHaveAttribute('data-count', '1')
  })

  it('shows the warning badges', () => {
    render(<ProductDetailClient product={baseProduct({ fragile: true })} />)
    expect(screen.getByText('fragile-badge')).toBeInTheDocument()
  })

  it('copies the page link when sharing without the Web Share API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    render(<ProductDetailClient product={baseProduct()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard!', 'success')
  })
})
