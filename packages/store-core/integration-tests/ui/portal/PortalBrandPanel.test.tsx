import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PortalBrandPanel from '@/components/portal/PortalBrandPanel'

describe('PortalBrandPanel', () => {
  it('shows the badge, heading, every point and the footnote', () => {
    render(
      <PortalBrandPanel
        badge="Certificate Portal"
        heading="Everything verified"
        points={['Instant lookup', 'Signed PDFs']}
        footnote="Need help? Contact us."
      />
    )
    expect(screen.getByText('Certificate Portal')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Everything verified' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(['Instant lookup', 'Signed PDFs'])
    expect(screen.getByText('Need help? Contact us.')).toBeInTheDocument()
  })

  it('omits the footnote and renders an empty list when none is given', () => {
    render(<PortalBrandPanel badge="B" heading="H" points={[]} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.queryByText(/contact/i)).toBeNull()
  })
})
