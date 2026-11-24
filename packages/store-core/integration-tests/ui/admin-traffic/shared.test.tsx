import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Change, PointChange, Note, ratio, rateText, bucketLabel } from '@/components/admin/traffic/shared'

describe('traffic shared', () => {
  it('Change shows a signed percentage, "new" without a baseline, and flips colour when inverted', () => {
    const { rerender } = render(<Change cur={150} prev={100} />)
    expect(screen.getByText('+50.0%').className).toContain('text-green-600')
    rerender(<Change cur={150} prev={100} invert />)
    expect(screen.getByText('+50.0%').className).toContain('text-red-500')
    rerender(<Change cur={5} prev={0} />)
    expect(screen.getByText('new')).toBeInTheDocument()
    rerender(<Change cur={50} prev={100} />)
    expect(screen.getByText('-50.0%')).toBeInTheDocument()
  })

  it('PointChange shows percentage points or nothing when a rate is missing', () => {
    const { container, rerender } = render(<PointChange cur={0.3} prev={0.2} />)
    expect(screen.getByText('+10.0 pts')).toBeInTheDocument()
    rerender(<PointChange cur={null} prev={0.2} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('Note renders its children', () => {
    render(<Note>Sessions are deduped</Note>)
    expect(screen.getByText('Sessions are deduped')).toBeInTheDocument()
  })

  it('ratio, rateText and bucketLabel format values', () => {
    expect(ratio(1, 4)).toBe(0.25)
    expect(ratio(1, 0)).toBeNull()
    expect(rateText(1, 4)).toBe('25.0%')
    expect(rateText(1, 0)).toBe('-')
    expect(bucketLabel('2026-03-05', 'week')).toMatch(/^wk /)
    expect(bucketLabel('2026-03-05', 'day')).toMatch(/5/)
  })
})
