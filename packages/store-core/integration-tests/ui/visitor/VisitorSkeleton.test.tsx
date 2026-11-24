import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import VisitorSkeleton from '@/components/visitor/VisitorSkeleton'

describe('VisitorSkeleton', () => {
  it('page variant (default): heading placeholders plus 8 text lines', () => {
    const { container } = render(<VisitorSkeleton />)
    expect(container.querySelector('.max-w-4xl')).not.toBeNull()
    expect(container.querySelectorAll('.space-y-3 > div')).toHaveLength(8)
  })

  it('form variant: four labelled fields plus the submit placeholder inside a card', () => {
    const { container } = render(<VisitorSkeleton variant="form" />)
    expect(container.querySelector('.max-w-md')).not.toBeNull()
    expect(container.querySelectorAll('.space-y-4 > div')).toHaveLength(5)
  })

  it('list variant: six row placeholders', () => {
    const { container } = render(<VisitorSkeleton variant="list" />)
    expect(container.querySelector('.max-w-7xl')).not.toBeNull()
    expect(container.querySelectorAll('.h-20')).toHaveLength(6)
  })

  it('exposes no interactive content or text', () => {
    const { container } = render(<VisitorSkeleton />)
    expect(container.querySelector('button, a, input')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
