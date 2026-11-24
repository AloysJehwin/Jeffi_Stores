import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: any) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/ui/ImgWithSkeleton', () => ({ default: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('@/components/shared/ProductWarningBadges', () => ({ default: ({ fragile }: any) => (fragile ? <span>fragile-badge</span> : null) }))
vi.mock('@/components/visitor/QuickAddButton', () => ({
  default: (p: any) => <button data-testid="quick-add" data-price={p.displayPrice} data-digital={String(p.isDigital)} data-instock={String(p.inStock)}>quick-add</button>,
}))
vi.mock('@/components/visitor/QuickAddPicker', () => ({
  QuickAddHeaderActions: ({ onClose }: any) => <button onClick={onClose}>sheet-close</button>,
}))
const resolveEdd = vi.fn<(...a: any[]) => Promise<string | null>>()
vi.mock('@/lib/shipping/edd-cache', () => ({ resolveEdd: (...a: any[]) => resolveEdd(...a) }))
const auth: { user: any } = { user: null }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const flags = { gstEnabled: true, digitalProductsEnabled: true }
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags }) }))

import ProductCard from '@/components/business/ProductCard'

const base = {
  id: 'p1',
  name: 'Halo Headphones',
  slug: 'halo-headphones',
  hasVariants: false,
  displayPrice: 1000,
  mrp: 1250,
  mrpDiscount: 20,
  effectiveStock: 5,
  primaryImage: { image_url: '/halo.jpg' },
  brandName: 'Halo',
  categoryName: 'Audio',
  categoryId: 'c1',
}

describe('business ProductCard', () => {
  beforeEach(() => {
    auth.user = null
    flags.gstEnabled = true
    flags.digitalProductsEnabled = true
    resolveEdd.mockResolvedValue(null)
  })

  it('shows name, brand, category, price with MRP strike-through and the discount', () => {
    render(<ProductCard {...base} />)
    expect(screen.getByRole('heading', { name: 'Halo Headphones' })).toBeInTheDocument()
    expect(screen.getByText('Brand: Halo')).toBeInTheDocument()
    expect(screen.getByText('Category: Audio')).toBeInTheDocument()
    expect(screen.getByText(/₹\s*1,000\.00/)).toBeInTheDocument()
    expect(screen.getByText(/₹1,250\.00/)).toBeInTheDocument()
    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText('Inclusive of all taxes')).toBeInTheDocument()
    expect(screen.getByText('In Stock')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/business/products/halo-headphones')
  })

  it('prefixes "From" for products with variants and drops the tax note when GST is off', () => {
    flags.gstEnabled = false
    render(<ProductCard {...base} hasVariants />)
    expect(screen.getByText(/From/)).toBeInTheDocument()
    expect(screen.queryByText('Inclusive of all taxes')).toBeNull()
  })

  it('applies the buyer category business discount and marks it as their price', () => {
    auth.user = { businessDiscountMap: { c1: 10 } }
    render(<ProductCard {...base} />)
    expect(screen.getByText(/₹\s*900\.00/)).toBeInTheDocument()
    expect(screen.getByText('Business offer')).toBeInTheDocument()
    expect(screen.getByText('Your business price')).toBeInTheDocument()
    expect(screen.getByText(/₹\s*1,000\.00/)).toBeInTheDocument()
    expect(screen.queryByText('20% off')).toBeNull()
    expect(screen.getByTestId('quick-add')).toHaveAttribute('data-price', '900')
  })

  it('marks a sold-out product', () => {
    render(<ProductCard {...base} effectiveStock={0} />)
    expect(screen.getByText('Out of Stock')).toBeInTheDocument()
    expect(screen.getByTestId('quick-add')).toHaveAttribute('data-instock', 'false')
  })

  it('treats a digital product as instantly available and skips delivery estimates', () => {
    render(<ProductCard {...base} isDigital effectiveStock={0} />)
    expect(screen.getByText('Digital')).toBeInTheDocument()
    expect(screen.getByText('Instant access')).toBeInTheDocument()
    expect(resolveEdd).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-add')).toHaveAttribute('data-digital', 'true')
  })

  it('shows a placeholder icon instead of an image, and the warning badges', () => {
    render(<ProductCard {...base} primaryImage={null} fragile />)
    expect(screen.queryByAltText('Halo Headphones')).toBeNull()
    expect(screen.getByText('fragile-badge')).toBeInTheDocument()
  })

  it('shows the delivery date when one resolves', async () => {
    resolveEdd.mockResolvedValue('2026-03-14')
    render(<ProductCard {...base} />)
    expect(await screen.findByText(/Deliver by/)).toBeInTheDocument()
    expect(screen.getByText('14 Mar')).toBeInTheDocument()
    expect(resolveEdd).toHaveBeenCalledWith(false, 2, 0, 'business')
  })

  it('copies the product link when sharing without the Web Share API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    render(<ProductCard {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/business/products/halo-headphones')))
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard!', 'success')
  })

  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render(<ProductCard {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share product' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Halo Headphones' })))
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('opens the quick-view sheet on a long press and closes it', () => {
    vi.useFakeTimers()
    render(<ProductCard {...base} />)
    const link = screen.getAllByRole('link')[0]
    fireEvent.touchStart(link)
    act(() => void vi.advanceTimersByTime(460))
    expect(screen.getByText('View Full Details')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByText('sheet-close'))
    expect(screen.queryByText('View Full Details')).toBeNull()
    vi.useRealTimers()
  })

  it('does not open the sheet when the touch ends early', () => {
    vi.useFakeTimers()
    render(<ProductCard {...base} />)
    const link = screen.getAllByRole('link')[0]
    fireEvent.touchStart(link)
    act(() => void vi.advanceTimersByTime(200))
    fireEvent.touchEnd(link)
    act(() => void vi.advanceTimersByTime(500))
    expect(screen.queryByText('View Full Details')).toBeNull()
    vi.useRealTimers()
  })
})
