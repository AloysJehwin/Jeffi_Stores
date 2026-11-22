import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'

// Renders at most three badges (flammable, hazardous, fragile) in that order; nothing when all flags are off.

describe('ProductWarningBadges', () => {
  it('renders nothing when no flags are set', () => {
    const { container } = render(<ProductWarningBadges />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when flags are explicitly false/null', () => {
    const { container } = render(<ProductWarningBadges fragile={false} hazardous={null} flammable={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a single badge for a single flag', () => {
    render(<ProductWarningBadges fragile />)
    expect(screen.getByText('FRAGILE')).toBeInTheDocument()
    expect(screen.queryByText('FLAMMABLE')).not.toBeInTheDocument()
    expect(screen.queryByText('HAZARDOUS')).not.toBeInTheDocument()
  })

  it('renders all three badges in flammable > hazardous > fragile order', () => {
    const { container } = render(<ProductWarningBadges fragile hazardous flammable />)
    const labels = Array.from(container.querySelectorAll('span')).map(s => s.textContent?.trim())
    expect(labels).toEqual(['FLAMMABLE', 'HAZARDOUS', 'FRAGILE'])
  })

  it('applies the xs size class variant', () => {
    const { container } = render(<ProductWarningBadges flammable size="xs" />)
    const badge = screen.getByText('FLAMMABLE').closest('span')
    expect(badge?.className).toContain('text-[8px]')
    // default sm would be text-[10px]
    expect(container.innerHTML).not.toContain('text-[10px]')
  })

  it('applies the default sm size class', () => {
    render(<ProductWarningBadges hazardous />)
    const badge = screen.getByText('HAZARDOUS').closest('span')
    expect(badge?.className).toContain('text-[10px]')
  })
})
