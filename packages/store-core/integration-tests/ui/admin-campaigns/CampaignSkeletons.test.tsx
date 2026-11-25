import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignDetailSkeleton, CampaignCardListSkeleton, ScenarioDetailSkeleton, CampaignPageSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'

describe('campaign skeletons', () => {
  it('detail and scenario skeletons are labelled busy regions', () => {
    const { rerender } = render(<CampaignDetailSkeleton />)
    expect(screen.getByLabelText('Loading campaign')).toHaveAttribute('aria-busy', 'true')
    rerender(<ScenarioDetailSkeleton />)
    expect(screen.getByLabelText('Loading scenario')).toHaveAttribute('aria-busy', 'true')
  })

  it('card list renders the requested count', () => {
    const { container } = render(<CampaignCardListSkeleton count={3} />)
    expect(container.firstElementChild?.children).toHaveLength(3)
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
  })

  it('page skeleton wraps its children under a breadcrumb or title placeholder', () => {
    const { container, rerender } = render(<CampaignPageSkeleton><p>Body</p></CampaignPageSkeleton>)
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(container.querySelector('.h-4.w-40')).toBeInTheDocument()
    rerender(<CampaignPageSkeleton title><p>Body</p></CampaignPageSkeleton>)
    expect(container.querySelector('.h-8.w-48')).toBeInTheDocument()
  })
})
