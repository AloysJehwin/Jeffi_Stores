import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DemoTotals, money } from '@/components/visitor/site/code/parts/cart/demo-ui'

const line = (price: number, qty: number) => ({ id: `l${price}`, name: 'Item', url: '#', image: null, price, mrp: null, qty, brand: null }) as any

describe('cart demo-ui', () => {
  it('formats rupees with Indian grouping and two decimals', () => {
    expect(money(1234567.5)).toBe('₹12,34,567.50')
    expect(money(0)).toBe('₹0.00')
  })

  it('DemoTotals sums the sample lines and counts items', () => {
    render(<DemoTotals lines={[line(500, 2), line(250.5, 1)]} />)
    expect(screen.getByText('Subtotal (3 items)')).toBeInTheDocument()
    expect(screen.getAllByText('₹1,250.50')).toHaveLength(2) // subtotal and total
    expect(screen.getByText('Price inclusive of all taxes')).toBeInTheDocument()
    expect(screen.queryByText('Delivery')).toBeNull()
  })

  it('shows free delivery on the checkout variant', () => {
    render(<DemoTotals lines={[line(100, 1)]} delivery />)
    expect(screen.getByText('Delivery')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('shows zero for no lines', () => {
    render(<DemoTotals lines={[]} />)
    expect(screen.getByText('Subtotal (0 items)')).toBeInTheDocument()
    expect(screen.getAllByText('₹0.00')).toHaveLength(2)
  })
})
