import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BusinessCta from '@/components/visitor/home/BusinessCta'

const urls = { businessLandingUrl: 'https://biz.test/about', businessSignupUrl: 'https://biz.test/signup' }

describe('BusinessCta', () => {
  it('shows the default copy, the perks and links to signup and the landing page', () => {
    render(<BusinessCta {...urls} />)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Tiered bulk pricing')).toBeInTheDocument()
    expect(screen.getByText('GST-compliant invoices')).toBeInTheDocument()
    expect(screen.getByText('24h RFQ turnaround')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Learn More' })).toHaveAttribute('href', urls.businessLandingUrl)
    const cta = screen.getAllByRole('link').find(l => l.getAttribute('href') === urls.businessSignupUrl)
    expect(cta).toBeDefined()
  })

  it('uses custom title, subtitle, label and url', () => {
    render(<BusinessCta {...urls} title="Buy in bulk" subtitle="Save more" ctaLabel="Register" ctaUrl="/register" />)
    expect(screen.getByRole('heading', { name: 'Buy in bulk' })).toBeInTheDocument()
    expect(screen.getByText('Save more')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute('href', '/register')
  })

  it('swaps the flagship-only RFQ promise for neutral copy on other stores', () => {
    render(<BusinessCta {...urls} flagshipCopy={false} />)
    expect(screen.getByText('Quotes on request')).toBeInTheDocument()
    expect(screen.queryByText('24h RFQ turnaround')).toBeNull()
  })
})
