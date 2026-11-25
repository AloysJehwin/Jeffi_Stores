import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AboutSkeleton, SupportSkeleton, HomeSkeleton, BusinessHomeSkeleton } from '@/components/visitor/skeletons/marketing'

describe('marketing skeletons', () => {
  it('AboutSkeleton is a busy status that keeps the page copy', () => {
    render(<AboutSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading about' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Quality Products')).toBeInTheDocument()
    expect(screen.getByText('24/7 Support')).toBeInTheDocument()
    expect(screen.getByText('Expert Team')).toBeInTheDocument()
  })

  it('SupportSkeleton keeps the real heading for the store and the business portal', () => {
    const store = render(<SupportSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading support' })).toBeInTheDocument()
    expect(screen.getByText('Help & Support')).toBeInTheDocument()
    const storeSk = store.container.querySelectorAll('.sk').length
    store.unmount()
    const biz = render(<SupportSkeleton portal="business" />)
    expect(screen.getByText('Help & Support')).toBeInTheDocument()
    expect(biz.container.querySelectorAll('.sk').length).toBeGreaterThan(0)
    expect(storeSk).toBeGreaterThan(0)
  })

  it('HomeSkeleton draws the hero and four product cards', () => {
    const { container } = render(<HomeSkeleton />)
    expect(screen.getByRole('status', { name: 'Loading home' })).toBeInTheDocument()
    expect(container.querySelectorAll('.grid-cols-2.md\\:grid-cols-4 > div')).toHaveLength(4)
  })

  it('BusinessHomeSkeleton falls back to the default home when no layout is published', () => {
    render(<BusinessHomeSkeleton sections={null} />)
    expect(screen.getByRole('status', { name: 'Loading home' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('BusinessHomeSkeleton draws the published layout when there is one', () => {
    render(<BusinessHomeSkeleton sections={[{ type: 'trust_strip', side: 'full' } as any, { type: 'about', side: 'full' } as any]} />)
    expect(screen.getByRole('status', { name: 'Loading home' })).toBeInTheDocument()
    expect(screen.getByRole('main').querySelectorAll('.sk').length).toBeGreaterThan(0)
  })
})
