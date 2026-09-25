import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { queryOneMock } = vi.hoisted(() => ({ queryOneMock: vi.fn() }))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: queryOneMock,
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

import { toReviewSummary } from '@/components/visitor/pdp/review-summary'
import { getApprovedReviewSummary } from '@/components/visitor/pdp/review-summary.server'
import ReviewSummaryLink from '@/components/visitor/pdp/ReviewSummaryLink'

afterEach(cleanup)

describe('toReviewSummary', () => {
  it('rounds the average to one decimal', () => {
    expect(toReviewSummary({ total: 3, average: 4.3333 })).toEqual({ average: 4.3, total: 3 })
  })

  it('is empty when there are no rows, no reviews or no average', () => {
    expect(toReviewSummary(null)).toEqual({ average: 0, total: 0 })
    expect(toReviewSummary({ total: 0, average: null })).toEqual({ average: 0, total: 0 })
    expect(toReviewSummary({ total: 2, average: null })).toEqual({ average: 0, total: 0 })
  })

  it('accepts numeric strings from the driver and clamps to the 1-5 scale', () => {
    expect(toReviewSummary({ total: '2', average: '4.5' })).toEqual({ average: 4.5, total: 2 })
    expect(toReviewSummary({ total: 1, average: 9 })).toEqual({ average: 5, total: 1 })
  })
})

describe('getApprovedReviewSummary', () => {
  it('counts approved reviews of the product only', async () => {
    queryOneMock.mockResolvedValueOnce({ total: 4, average: 4.25 })
    const summary = await getApprovedReviewSummary('prod-1')
    expect(summary).toEqual({ average: 4.3, total: 4 })
    const [sql, params] = queryOneMock.mock.calls[0]
    expect(sql).toMatch(/is_approved = true/)
    expect(sql).toMatch(/product_id = \$1/)
    expect(params).toEqual(['prod-1'])
  })

  it('returns an empty summary instead of throwing when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    queryOneMock.mockRejectedValueOnce(new Error('db down'))
    await expect(getApprovedReviewSummary('prod-1')).resolves.toEqual({ average: 0, total: 0 })
  })
})

describe('ReviewSummaryLink', () => {
  it('renders nothing without approved reviews', () => {
    const { container } = render(<ReviewSummaryLink summary={{ average: 0, total: 0 }} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the average and count and links to the reviews section', () => {
    render(<ReviewSummaryLink summary={{ average: 4.3, total: 12 }} />)
    const link = screen.getByRole('link', { name: /Rated 4\.3 out of 5 from 12 reviews/ })
    expect(link.getAttribute('href')).toBe('#reviews')
    expect(screen.getByText('4.3')).toBeTruthy()
    expect(screen.getByText('12 reviews')).toBeTruthy()
  })

  it('scrolls to the reviews section on click', () => {
    const target = document.createElement('div')
    target.id = 'reviews'
    target.scrollIntoView = vi.fn()
    document.body.appendChild(target)
    render(<ReviewSummaryLink summary={{ average: 5, total: 1 }} />)
    screen.getByRole('link').click()
    expect(target.scrollIntoView).toHaveBeenCalled()
    target.remove()
  })
})
