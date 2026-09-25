import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import type { PdpCard } from '@/components/visitor/pdp/pdp'

const { addToCartMock, showToastMock } = vi.hoisted(() => ({ addToCartMock: vi.fn(), showToastMock: vi.fn() }))

vi.mock('@/contexts/CartContext', () => ({ useCart: () => ({ addToCart: addToCartMock }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: showToastMock }) }))
vi.mock('@/contexts/StoreConfigContext', () => ({ useStoreConfig: () => ({ flags: { gstEnabled: true } }) }))

import FrequentlyBoughtTogether from '@/components/visitor/pdp/FrequentlyBoughtTogether'

const card = (over: Partial<PdpCard> & Pick<PdpCard, 'id' | 'name'>): PdpCard => ({
  slug: over.id, hasVariants: false, displayPrice: 100, mrp: null, effectiveStock: 1, primaryImage: null, ...over,
})

const current = card({ id: 'cur', name: 'Trolley Jack', displayPrice: 2500 })
const cover = card({ id: 'cover', name: 'Earth Bit Cover', displayPrice: 99.71, mrp: 398.84 })
const arrester = card({ id: 'arrester', name: 'Lightning Arrester', hasVariants: true, displayPrice: 499.51 })
const soldOut = card({ id: 'gone', name: 'Sold Out Clamp', effectiveStock: 0 })

function mockAffinity(products: PdpCard[]) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ products }) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FrequentlyBoughtTogether', () => {
  it('asks the affinity API for up to 3 co-purchases of this product', async () => {
    const fetchMock = mockAffinity([cover])
    render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Frequently bought together')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/affinity?kind=bought&ids=cur&limit=3')
  })

  it('renders nothing when there are no co-purchases', async () => {
    const fetchMock = mockAffinity([])
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('ticks every directly addable item and totals them', async () => {
    mockAffinity([cover, arrester, soldOut])
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Frequently bought together')

    expect((screen.getByRole('checkbox', { name: 'Include Trolley Jack' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Include Earth Bit Cover' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: 'Include Lightning Arrester' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Include Sold Out Clamp' })).toBeNull()
    expect(screen.getByText('Total for 2 items')).toBeTruthy()
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('₹2,599.71')
    expect(screen.getByRole('link', { name: 'Choose options' }).getAttribute('href')).toBe('/products/arrester')
    expect(screen.getByText('Out of stock')).toBeTruthy()
  })

  it('adds only the ticked items, one of each, through the cart', async () => {
    mockAffinity([cover, arrester])
    addToCartMock.mockResolvedValue(undefined)
    const { container } = render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Frequently bought together')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Trolley Jack' }))
    expect(screen.getByText('Total for 1 item')).toBeTruthy()
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('₹99.71')

    fireEvent.click(screen.getByRole('button', { name: 'Add selected to cart' }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Item added to cart!', 'success'))
    expect(addToCartMock).toHaveBeenCalledTimes(1)
    expect(addToCartMock).toHaveBeenCalledWith('cover', 1)
  })

  it('reports the items the cart rejected', async () => {
    mockAffinity([cover])
    addToCartMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('This item is currently out of stock'))
    render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Frequently bought together')

    fireEvent.click(screen.getByRole('button', { name: 'Add selected to cart' }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(
      'Added 1 of 2 items. Earth Bit Cover: This item is currently out of stock', 'error',
    ))
  })

  it('points a variant product on its own page at the options above instead of adding it', async () => {
    mockAffinity([cover])
    render(<FrequentlyBoughtTogether current={{ ...current, hasVariants: true }} />)
    await screen.findByText('Frequently bought together')

    expect(screen.queryByRole('checkbox', { name: 'Include Trolley Jack' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose options above' })).toBeTruthy()
    expect(screen.getByText('Total for 1 item')).toBeTruthy()
  })

  it('does not offer a product that is not launched yet', async () => {
    mockAffinity([cover])
    render(<FrequentlyBoughtTogether current={current} launchDate={new Date(Date.now() + 7 * 864e5)} />)
    await screen.findByText('Frequently bought together')

    expect(screen.queryByRole('checkbox', { name: 'Include Trolley Jack' })).toBeNull()
    expect(screen.getByText('Currently unavailable')).toBeTruthy()
  })

  it('hides the total and add button when no other item can be added directly', async () => {
    mockAffinity([arrester])
    render(<FrequentlyBoughtTogether current={current} />)
    await screen.findByText('Frequently bought together')

    expect(screen.queryByRole('button', { name: 'Add selected to cart' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Choose options' })).toBeTruthy()
  })
})
