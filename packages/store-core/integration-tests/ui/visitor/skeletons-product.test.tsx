import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ProductDetailSkeleton } from '@/components/visitor/skeletons/product'

describe('ProductDetailSkeleton', () => {
  it('is an accessible busy status with the static page chrome', () => {
    render(<ProductDetailSkeleton />)
    const status = screen.getByRole('status', { name: 'Loading product' })
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Product Description')).toBeInTheDocument()
    expect(screen.getByText('Check Delivery')).toBeInTheDocument()
    expect(screen.getByText('Quantity')).toBeInTheDocument()
    expect(screen.getByText('Enter pincode')).toBeInTheDocument()
  })

  it('draws shimmer placeholders for gallery thumbs and description lines', () => {
    const { container } = render(<ProductDetailSkeleton />)
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(15)
    expect(container.querySelectorAll('.aspect-square').length).toBeGreaterThanOrEqual(4)
  })

  it('pads the store portal for the bottom bar and the business portal evenly', () => {
    const store = render(<ProductDetailSkeleton />)
    expect(store.container.querySelector('.pb-20')).not.toBeNull()
    store.unmount()
    const biz = render(<ProductDetailSkeleton portal="business" />)
    expect(biz.container.querySelector('.pb-20')).toBeNull()
    expect(biz.container.querySelector('.py-4.lg\\:py-8')).not.toBeNull()
  })
})
