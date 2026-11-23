import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// "Frequently bought together" from co-purchases. Fetches /api/products/affinity (bought), renders a
// checklist + buy box. Directly-addable items (no variants, in stock) can be ticked and added; the
// addToCart context call is asserted. Contexts, Link and the image are stubbed.

vi.mock('@/components/ui/ImgWithSkeleton', () => ({
  default: (p: { src: string }) => <img data-testid="thumb" src={p.src} alt="" />,
}))
vi.mock('next/link', () => ({
  default: (p: { href: string; children: any }) => <a href={p.href}>{p.children}</a>,
}))

const addToCart = vi.fn<(...a: any[]) => any>(() => Promise.resolve())
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
const gstEnabled = vi.fn<() => boolean>(() => false)
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled: gstEnabled() } }) }))

import FrequentlyBoughtTogether from '@/components/visitor/pdp/FrequentlyBoughtTogether'

const current = {
  id: 'cur',
  name: 'Main Widget',
  slug: 'main-widget',
  hasVariants: false,
  displayPrice: 100,
  mrp: 150,
  effectiveStock: 5,
}
const addon = {
  id: 'add1',
  name: 'Addon One',
  slug: 'addon-one',
  hasVariants: false,
  displayPrice: 50,
  mrp: null,
  effectiveStock: 10,
}

function mockFetch(products: any[]) {
  const fn = vi.fn<(...a: any[]) => any>(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ products }) } as Response))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  addToCart.mockClear()
  showToast.mockClear()
  addToCart.mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

describe('FrequentlyBoughtTogether (render + branches)', () => {
  it('renders nothing when there are no co-purchased products', async () => {
    mockFetch([])
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await Promise.resolve()
    expect(container.firstChild).toBeNull()
  })

  it('renders the current item and the addon once the fetch resolves', async () => {
    mockFetch([addon])
    render(<FrequentlyBoughtTogether current={current} />)
    expect(await screen.findByText(/This item:/)).toBeInTheDocument()
    expect(screen.getByText('Main Widget')).toBeInTheDocument()
    expect(screen.getByText('Addon One')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Frequently bought together' })).toBeInTheDocument()
  })

  it('shows the buy box with the summed total of ticked items', async () => {
    mockFetch([addon])
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Addon One')
    // 100 + 50 = 150 total for 2 items. The total lives in the aria-live region.
    expect(screen.getByText('Total for 2 items')).toBeInTheDocument()
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('₹150.00')
  })

  it('unchecking an item updates the total and count', async () => {
    mockFetch([addon])
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Addon One')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Addon One' }))
    expect(screen.getByText('Total for 1 item')).toBeInTheDocument()
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('₹100.00')
  })

  it('adds every ticked item to the cart when the buy button is clicked', async () => {
    mockFetch([addon])
    render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Addon One')
    fireEvent.click(screen.getByRole('button', { name: 'Add selected to cart' }))
    // Two addToCart calls (current + addon), each qty 1.
    await vi.waitFor(() => expect(addToCart).toHaveBeenCalledTimes(2))
    expect(addToCart).toHaveBeenCalledWith('cur', 1)
    expect(addToCart).toHaveBeenCalledWith('add1', 1)
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('2 items added to cart!', 'success'))
  })

  it('links a variant addon to its options instead of a checkbox', async () => {
    const variantAddon = { ...addon, id: 'v1', name: 'Variant Addon', slug: 'variant-addon', hasVariants: true }
    mockFetch([variantAddon])
    render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Variant Addon')
    expect(screen.queryByRole('checkbox', { name: 'Include Variant Addon' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Choose options' }).length).toBeGreaterThan(0)
  })
})
