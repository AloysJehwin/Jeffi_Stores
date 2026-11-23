import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Slim bottom bar shown only after the main buy buttons scroll past the header. We drive that by a fake
// IntersectionObserver that reports the buttons as out of view above the fold, so pastControls flips true.

vi.mock('@/components/ui/ImgWithSkeleton', () => ({
  default: (p: { src: string }) => <img data-testid="thumb" src={p.src} alt="" />,
}))

const compareList = vi.fn<() => any[]>(() => [])
vi.mock('@/contexts/CompareContext', () => ({ useCompare: () => ({ compareList: compareList() }) }))

import StickyAddToCartBar from '@/components/visitor/pdp/StickyAddToCartBar'

// Install an IO that fires immediately with an entry past the top; capture whether it is used.
function installPastControlsObserver(past = true) {
  class FakeIO {
    cb: (entries: any[]) => void
    constructor(cb: (entries: any[]) => void) {
      this.cb = cb
    }
    observe() {
      this.cb([{ isIntersecting: !past, boundingClientRect: { bottom: past ? 0 : 999 }, rootBounds: { top: 80 } }])
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', FakeIO as any)
}

beforeEach(() => {
  compareList.mockReturnValue([])
  // The buy-buttons anchor the bar observes.
  const anchor = document.createElement('div')
  anchor.id = 'pdp-buy-buttons'
  document.body.appendChild(anchor)
})

const base = {
  name: 'Widget',
  price: 499,
  quantity: 1,
  adding: false,
  onAdd: () => {},
}

describe('StickyAddToCartBar (render + branches)', () => {
  it('renders nothing while the main buttons are still in view', () => {
    installPastControlsObserver(false)
    const { container } = render(<StickyAddToCartBar action="add" {...base} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is no action, even past the controls', () => {
    installPastControlsObserver(true)
    const { container } = render(<StickyAddToCartBar action={null} {...base} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the Add to Cart bar once scrolled past the controls', () => {
    installPastControlsObserver(true)
    render(<StickyAddToCartBar action="add" {...base} image="/img.png" />)
    expect(screen.getByRole('region', { name: 'Quick add to cart' })).toBeInTheDocument()
    expect(screen.getByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('Rs. 499.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()
  })

  it('fires onAdd when the Add to Cart button is clicked', () => {
    installPastControlsObserver(true)
    const onAdd = vi.fn<(...a: any[]) => any>()
    render(<StickyAddToCartBar action="add" {...base} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('shows the adding spinner label and disables the button when adding', () => {
    installPastControlsObserver(true)
    render(<StickyAddToCartBar action="add" {...base} adding />)
    const btn = screen.getByRole('button', { name: 'Adding...' })
    expect(btn).toBeDisabled()
  })

  it('shows Buy Now labelling for digital products', () => {
    installPastControlsObserver(true)
    render(<StickyAddToCartBar action="add" {...base} buyNow />)
    expect(screen.getByRole('region', { name: 'Quick buy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy Now' })).toBeInTheDocument()
  })

  it('renders a Choose options button for the choose action', () => {
    installPastControlsObserver(true)
    render(<StickyAddToCartBar action="choose" {...base} />)
    expect(screen.getByRole('button', { name: 'Choose options' })).toBeInTheDocument()
  })

  it('shows the struck MRP and quantity when provided', () => {
    installPastControlsObserver(true)
    render(<StickyAddToCartBar action="add" {...base} mrp={799} quantity={3} />)
    expect(screen.getByText('Rs. 799.00')).toBeInTheDocument()
    expect(screen.getByText('Qty 3')).toBeInTheDocument()
  })
})
