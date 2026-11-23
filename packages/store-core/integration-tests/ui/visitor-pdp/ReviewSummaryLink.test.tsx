import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewSummaryLink from '@/components/visitor/pdp/ReviewSummaryLink'

// Compact rating link near the title: renders nothing with no reviews; otherwise a labelled anchor that
// jumps to the reviews section (scrollIntoView on #reviews), with singular/plural review noun.

describe('ReviewSummaryLink (render + branches)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders nothing when there are no reviews', () => {
    const { container } = render(<ReviewSummaryLink summary={{ total: 0, average: 0 }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the average and a pluralised review count', () => {
    render(<ReviewSummaryLink summary={{ total: 12, average: 4.25 }} />)
    expect(screen.getByText('4.3')).toBeInTheDocument()
    expect(screen.getByText('12 reviews')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'aria-label',
      'Rated 4.3 out of 5 from 12 reviews. Go to reviews'
    )
  })

  it('uses the singular noun for a single review', () => {
    render(<ReviewSummaryLink summary={{ total: 1, average: 5 }} />)
    expect(screen.getByText('1 review')).toBeInTheDocument()
  })

  it('scrolls to the reviews section on click (preventing default navigation)', () => {
    const target = document.createElement('div')
    target.id = 'reviews'
    const scrollIntoView = vi.fn<(...a: any[]) => any>()
    target.scrollIntoView = scrollIntoView
    document.body.appendChild(target)

    render(<ReviewSummaryLink summary={{ total: 3, average: 4 }} />)
    const link = screen.getByRole('link')
    const evt = fireEvent.click(link)
    // default was prevented (handler returns false meaning preventDefault was called)
    expect(evt).toBe(false)
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
