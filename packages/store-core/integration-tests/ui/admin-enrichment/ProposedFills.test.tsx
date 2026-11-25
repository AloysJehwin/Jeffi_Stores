import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProposedFills } from '@/components/admin/enrichment/ProposedFills'

describe('ProposedFills', () => {
  it('lists only the filled fields and the FAQs', () => {
    render(<ProposedFills item={{ short_description: 'A sturdy drill', meta_title: 'Drill', faqs: [{ question: 'Is it cordless?', answer: 'Yes' }] }} />)
    expect(screen.getByText('Fills empty product fields')).toBeInTheDocument()
    expect(screen.getByText('Short description')).toBeInTheDocument()
    expect(screen.getByText('A sturdy drill')).toBeInTheDocument()
    expect(screen.getByText('SEO title')).toBeInTheDocument()
    expect(screen.queryByText('Care instructions')).not.toBeInTheDocument()
    expect(screen.getByText(/FAQs \(1, added only if the product has none\)/)).toBeInTheDocument()
    expect(screen.getByText('Is it cordless?')).toBeInTheDocument()
  })

  it('renders nothing when the proposal fills nothing', () => {
    const { container } = render(<ProposedFills item={{ short_description: null, faqs: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
