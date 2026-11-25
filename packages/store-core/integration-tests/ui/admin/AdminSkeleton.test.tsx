import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import AdminSkeleton from '@/components/admin/AdminSkeleton'

describe('AdminSkeleton', () => {
  it('list variant: four stat cards, a toolbar and the requested rows', () => {
    const { container } = render(<AdminSkeleton rows={3} />)
    expect(container.querySelectorAll('.grid.grid-cols-2.md\\:grid-cols-4 > div')).toHaveLength(4)
    expect(container.querySelectorAll('.h-14')).toHaveLength(3)
  })

  it('list variant can hide the stats', () => {
    const { container } = render(<AdminSkeleton showStats={false} />)
    expect(container.querySelectorAll('.grid.grid-cols-2.md\\:grid-cols-4')).toHaveLength(0)
    expect(container.querySelectorAll('.h-14')).toHaveLength(6)
  })

  it('detail variant: hero with four tiles and a three column body', () => {
    const { container } = render(<AdminSkeleton variant="detail" />)
    expect(container.querySelectorAll('.grid.sm\\:grid-cols-4 > div, .grid.grid-cols-2.sm\\:grid-cols-4 > div')).toHaveLength(4)
    expect(container.querySelector('.lg\\:grid-cols-3')).not.toBeNull()
    expect(container.querySelector('.bg-zinc-800')).not.toBeNull()
  })

  it('form variant: six field blocks', () => {
    const { container } = render(<AdminSkeleton variant="form" />)
    expect(container.querySelectorAll('.lg\\:grid-cols-3')).toHaveLength(0)
    expect(container.querySelectorAll('.h-10.bg-surface-secondary')).toHaveLength(8)
  })

  it('dashboard variant: stat grid and chart columns', () => {
    const { container } = render(<AdminSkeleton variant="dashboard" />)
    expect(container.querySelectorAll('.grid.grid-cols-2.md\\:grid-cols-4 > div')).toHaveLength(4)
    expect(container.querySelector('.lg\\:grid-cols-3')).not.toBeNull()
  })

  it('always renders the title and subtitle placeholders', () => {
    const { container } = render(<AdminSkeleton variant="form" />)
    expect(container.querySelector('.h-8.w-48')).not.toBeNull()
    expect(container.querySelector('.h-4.w-72')).not.toBeNull()
  })
})
