import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'

describe('AdminStatsSkeleton', () => {
  it('renders four cards in a 4-col grid by default', () => {
    const { container } = render(<AdminStatsSkeleton />)
    expect(container.querySelectorAll('.grid > div')).toHaveLength(4)
    expect(container.querySelector('.grid')).toHaveClass('md:grid-cols-4')
  })

  it('derives columns from the card count and falls back for unknown counts', () => {
    const three = render(<AdminStatsSkeleton cards={3} />)
    expect(three.container.querySelector('.grid')).toHaveClass('md:grid-cols-3')
    const seven = render(<AdminStatsSkeleton cards={7} />)
    expect(seven.container.querySelector('.grid')).toHaveClass('md:grid-cols-4')
  })

  it('uses a verbatim gridClass override and renders the banner', () => {
    const { container } = render(<AdminStatsSkeleton cards={2} gridClass="grid-cols-3" banner />)
    expect(container.querySelector('.grid')).toHaveClass('grid-cols-3')
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })
})

describe('AdminTableSkeleton', () => {
  it('renders 8 mobile cards and 8 desktop rows by default', () => {
    const { container } = render(<AdminTableSkeleton />)
    expect(container.querySelectorAll('.md\\:hidden > div')).toHaveLength(8)
    expect(container.querySelectorAll('.hidden.md\\:block > div.h-14')).toHaveLength(8)
  })

  it('honours rows and cols', () => {
    const { container } = render(<AdminTableSkeleton rows={2} cols={4} />)
    expect(container.querySelectorAll('.md\\:hidden > div')).toHaveLength(2)
    expect(container.querySelectorAll('.hidden.lg\\:block')).toHaveLength(4)
  })
})
