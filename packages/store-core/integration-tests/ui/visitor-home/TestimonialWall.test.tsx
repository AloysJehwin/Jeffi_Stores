import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Testimonial } from '@/lib/catalog/homepage-extras'

// Mock the carousel (keyboard/scroll behaviour, tested elsewhere) and next/link so we assert
// TestimonialWall's own output: rating aria-label, quote, author, verified badge, product link.
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="carousel">{children}</div>,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import TestimonialWall from '@/components/visitor/home/TestimonialWall'

const items: Testimonial[] = [
  {
    id: 't1',
    rating: 5,
    title: 'Great buy',
    comment: 'Exactly as described, fast shipping.',
    author: 'Asha',
    verified: true,
    productName: 'Drill Kit',
    productSlug: 'drill-kit',
  },
  {
    id: 't2',
    rating: 3,
    title: null,
    comment: 'Decent for the price.',
    author: 'Ravi',
    verified: false,
    productName: 'Tape Measure',
    productSlug: 'tape-measure',
  },
]

describe('TestimonialWall (render)', () => {
  it('renders each testimonial: quote, author, rating label, product link', () => {
    render(<TestimonialWall items={items} />)
    expect(screen.getByText(/Exactly as described/)).toBeInTheDocument()
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByLabelText('Rated 5 out of 5')).toBeInTheDocument()
    expect(screen.getByLabelText('Rated 3 out of 5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Drill Kit' })).toHaveAttribute('href', '/products/drill-kit')
  })

  it('shows the verified badge only for verified purchases', () => {
    render(<TestimonialWall items={items} />)
    // Asha is verified, Ravi is not -> exactly one badge.
    expect(screen.getAllByText('Verified purchase')).toHaveLength(1)
  })

  it('renders a grid by default and the carousel when carousel=true', () => {
    const { rerender } = render(<TestimonialWall items={items} />)
    expect(screen.queryByTestId('carousel')).toBeNull()
    rerender(<TestimonialWall items={items} carousel />)
    expect(screen.getByTestId('carousel')).toBeInTheDocument()
  })
})
