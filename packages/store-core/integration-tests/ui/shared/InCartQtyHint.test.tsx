import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InCartQtyHint from '@/components/shared/InCartQtyHint'
import type { PickerQtyCap } from '@/lib/catalog/cart-unit-cap'

// Hint under an add-to-cart picker. Branch order: over-cap error > full > in-cart count > nothing.

function cap(partial: Partial<PickerQtyCap>): PickerQtyCap {
  return { inCart: 0, min: 1, max: undefined, full: false, ...partial }
}

describe('InCartQtyHint', () => {
  it('renders nothing when nothing is in the cart and no cap', () => {
    const { container } = render(<InCartQtyHint cap={cap({ inCart: 0 })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the in-cart count with the unit label', () => {
    render(<InCartQtyHint cap={cap({ inCart: 5 })} unitLabel="kg" />)
    expect(screen.getByRole('status')).toHaveTextContent('5 kg already in cart')
  })

  it('shows the in-cart count without a unit label', () => {
    render(<InCartQtyHint cap={cap({ inCart: 2 })} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 already in cart')
  })

  it('shows the full message when the line already holds the max', () => {
    render(<InCartQtyHint cap={cap({ inCart: 10, max: 0, full: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Max quantity already in cart')
  })

  it('shows the over-cap error when adding more than the remaining room', () => {
    // max 10, 8 in cart -> 2 left; adding 5 overflows.
    render(<InCartQtyHint cap={cap({ inCart: 8, max: 2, full: false })} adding={5} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/You can add up to 2 more/)
    expect(status).toHaveTextContent(/max 10/)
  })

  it('falls through to the in-cart count when the adding amount fits', () => {
    // 2 left, adding 1 fits -> no error, show the plain in-cart line.
    render(<InCartQtyHint cap={cap({ inCart: 8, max: 2, full: false })} adding={1} unitLabel="pcs" />)
    expect(screen.getByRole('status')).toHaveTextContent('8 pcs already in cart')
  })
})
