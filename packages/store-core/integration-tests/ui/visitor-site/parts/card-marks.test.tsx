import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  PriceTagMark,
  DiscountBadgeMark,
  StockBadgeMark,
  RatingStarsMark,
  QuickAddMark,
  WishlistMark,
} from '@/components/visitor/site/code/parts/card/marks'

const product = { price: { formatted: '₹999' }, mrp: { formatted: '₹1,299' }, discountPct: 23, inStock: true, rating: 4.4, reviewCount: 12, hasVariants: false }

describe('PriceTagMark', () => {
  it('shows the price with the struck-through MRP, announced as MRP', () => {
    render(<PriceTagMark product={product} />)
    expect(screen.getByText('₹999')).toBeInTheDocument()
    expect(screen.getByText('₹1,299').closest('s')).toBeInTheDocument()
    expect(screen.getByText('MRP')).toHaveClass('sr-only')
  })

  it('prefixes From for variant products unless told not to', () => {
    const { rerender } = render(<PriceTagMark product={{ ...product, hasVariants: true }} />)
    expect(screen.getByText('From ₹999')).toBeInTheDocument()
    rerender(<PriceTagMark product={{ ...product, hasVariants: true }} from={false} />)
    expect(screen.getByText('₹999')).toBeInTheDocument()
  })

  it('can hide the MRP and show the discount', () => {
    render(<PriceTagMark product={product} mrp={false} discount />)
    expect(screen.queryByText('₹1,299')).toBeNull()
    expect(screen.getByText('23% off')).toBeInTheDocument()
  })

  it('renders nothing without a formatted price, and takes a custom class', () => {
    const { container, rerender } = render(<PriceTagMark product={{}} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PriceTagMark product={product} className="custom" />)
    expect(container.firstChild).toHaveClass('custom')
  })
})

describe('DiscountBadgeMark', () => {
  it('formats the discount three ways', () => {
    const { rerender } = render(<DiscountBadgeMark product={product} />)
    expect(screen.getByText('23% off')).toBeInTheDocument()
    rerender(<DiscountBadgeMark product={product} format="minus" />)
    expect(screen.getByText('−23%')).toBeInTheDocument()
    rerender(<DiscountBadgeMark product={product} format="sale" />)
    expect(screen.getByText('Sale')).toBeInTheDocument()
  })

  it('renders nothing without a discount', () => {
    const { container } = render(<DiscountBadgeMark product={{ discountPct: 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StockBadgeMark', () => {
  it('is silent for in-stock products unless always is set', () => {
    const { container, rerender } = render(<StockBadgeMark product={product} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<StockBadgeMark product={product} always inStockText="Available" />)
    expect(screen.getByText('Available')).toHaveClass('text-green-600')
  })

  it('shows sold out with custom words', () => {
    const { rerender } = render(<StockBadgeMark product={{ inStock: false }} />)
    expect(screen.getByText('Sold out')).toHaveClass('text-red-600')
    rerender(<StockBadgeMark product={{ inStock: false }} soldOut="Gone" />)
    expect(screen.getByText('Gone')).toBeInTheDocument()
  })
})

describe('RatingStarsMark', () => {
  it('describes the rating and shows the review count', () => {
    const { container } = render(<RatingStarsMark product={product} />)
    expect(screen.getByRole('img', { name: 'Rated 4.4 out of 5 from 12 reviews' })).toBeInTheDocument()
    expect(screen.getByText('(12)')).toBeInTheDocument()
    expect(container.querySelectorAll('svg.fill-current')).toHaveLength(4)
  })

  it('uses singular review, and can hide the count', () => {
    const { rerender } = render(<RatingStarsMark product={{ rating: 5, reviewCount: 1 }} count={false} />)
    expect(screen.getByRole('img', { name: 'Rated 5.0 out of 5 from 1 review' })).toBeInTheDocument()
    expect(screen.queryByText('(1)')).toBeNull()
    rerender(<RatingStarsMark product={{ rating: 3 }} />)
    expect(screen.getByRole('img', { name: 'Rated 3.0 out of 5' })).toBeInTheDocument()
  })

  it('renders nothing without a rating', () => {
    const { container } = render(<RatingStarsMark product={{ rating: 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('inert buttons for the studio preview', () => {
  it('QuickAddMark draws the label and icon without a real button', () => {
    const { container } = render(<QuickAddMark text="Add to cart" icon="cart" />)
    expect(screen.getByText('Add to cart')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('WishlistMark draws a heart with an optional label', () => {
    const { container } = render(<WishlistMark label="Save" className="heart" />)
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('heart')
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
