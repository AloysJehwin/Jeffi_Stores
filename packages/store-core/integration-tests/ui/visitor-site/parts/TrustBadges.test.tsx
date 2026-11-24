import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TrustBadges, { DEFAULT_TRUST_BADGES, TRUST_ICONS, badgeColumns } from '@/components/visitor/site/code/parts/checkout/TrustBadges'

describe('TrustBadges', () => {
  it('shows the four built-in reassurance badges by default', () => {
    render(<TrustBadges />)
    for (const b of DEFAULT_TRUST_BADGES) {
      expect(screen.getByText(b.title)).toBeInTheDocument()
      expect(screen.getByText(b.text!)).toBeInTheDocument()
    }
    expect(screen.getByText('Secure Checkout')).toBeInTheDocument()
  })

  it('shows the design\'s own badges, with the text optional', () => {
    const { container } = render(<TrustBadges items={[{ icon: 'truck', title: 'Free delivery', text: 'Over ₹999' }, { icon: 'gift', title: 'Gift wrap' }]} className="wrap" />)
    expect(screen.getByText('Free delivery')).toBeInTheDocument()
    expect(screen.getByText('Over ₹999')).toBeInTheDocument()
    expect(screen.getByText('Gift wrap')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('wrap')
    expect(container.querySelector(`path[d="${TRUST_ICONS.truck}"]`)).toBeInTheDocument()
  })

  it('falls back to the shield icon for an unknown icon name', () => {
    const { container } = render(<TrustBadges items={[{ icon: 'nope' as any, title: 'Odd' }]} />)
    expect(container.querySelector(`path[d="${TRUST_ICONS.shield}"]`)).toBeInTheDocument()
  })

  it('renders nothing without badges', () => {
    const { container } = render(<TrustBadges items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('badgeColumns clamps the column count to 1 to 4', () => {
    expect(badgeColumns(9).gridTemplateColumns).toContain('3 * 0.75rem')
    expect(badgeColumns(0).gridTemplateColumns).toContain('1 * 0.75rem')
    expect(badgeColumns(NaN).gridTemplateColumns).toContain('1 * 0.75rem')
    expect(badgeColumns(3).gridTemplateColumns).toContain('2 * 0.75rem')
  })
})
