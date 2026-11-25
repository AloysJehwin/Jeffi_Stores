import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkline } from '@/components/admin/dashboard/Sparkline'

describe('Sparkline', () => {
  it('draws a line and area for a series, scaled to the viewBox', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} ariaLabel="Orders trend" />)
    const svg = screen.getByRole('img', { name: 'Orders trend' })
    expect(svg).toHaveAttribute('viewBox', '0 0 96 32')
    const line = container.querySelector('[data-spark="line"]')!
    expect(line.getAttribute('d')).toMatch(/^M0\.0 /)
    expect(line.getAttribute('d')!.split('L')).toHaveLength(4)
    expect(container.querySelector('[data-spark="area"]')).toBeInTheDocument()
    expect(line.getAttribute('stroke')).toContain('--c-accent-')
  })

  it('renders a flat placeholder when there is not enough data', () => {
    const { container } = render(<Sparkline values={[4]} ariaLabel="Orders trend" />)
    expect(screen.getByRole('img', { name: 'Orders trend: no data' })).toBeInTheDocument()
    expect(container.querySelector('[data-spark="line"]')).not.toBeInTheDocument()
  })

  it('does not divide by zero for a constant series', () => {
    const { container } = render(<Sparkline values={[2, 2, 2]} />)
    expect(container.querySelector('[data-spark="line"]')!.getAttribute('d')).not.toContain('NaN')
  })
})
