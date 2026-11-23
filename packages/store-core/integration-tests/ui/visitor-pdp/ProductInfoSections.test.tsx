import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProductInfoSections, { faqJsonLd } from '@/components/visitor/pdp/ProductInfoSections'

// Shopper info blocks: what's in the box, usage/care/safety, FAQs (as <details>), Legal Metrology
// disclosures. Every block hides when empty; whole card returns null when all empty.

describe('ProductInfoSections (render + branches)', () => {
  it('renders nothing when there is no usage, legal or faq content', () => {
    const { container } = render(<ProductInfoSections product={{}} faqs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the "in the box" list split on newlines', () => {
    render(<ProductInfoSections product={{ in_the_box: 'Charger\nCable\n' }} />)
    expect(screen.getByText("What's in the box")).toBeInTheDocument()
    expect(screen.getByText('Charger')).toBeInTheDocument()
    expect(screen.getByText('Cable')).toBeInTheDocument()
  })

  it('renders usage, care and safety blocks when present', () => {
    render(
      <ProductInfoSections
        product={{ usage_instructions: 'Press start', care_instructions: 'Wipe clean', safety_warnings: 'Keep dry' }}
      />
    )
    expect(screen.getByText('How to use')).toBeInTheDocument()
    expect(screen.getByText('Press start')).toBeInTheDocument()
    expect(screen.getByText('Care')).toBeInTheDocument()
    expect(screen.getByText('Safety warnings')).toBeInTheDocument()
  })

  it('renders FAQs as expandable details with question and answer', () => {
    render(
      <ProductInfoSections
        product={{}}
        faqs={[{ id: 'f1', question: 'Is it waterproof?', answer: 'Yes, IP68.' }]}
      />
    )
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument()
    expect(screen.getByText('Is it waterproof?')).toBeInTheDocument()
    expect(screen.getByText('Yes, IP68.')).toBeInTheDocument()
  })

  it('renders only the legal disclosures that have a value', () => {
    render(
      <ProductInfoSections product={{ manufacturer_name: 'Acme', manufacturer_address: 'Pune', country_of_origin: 'India' }} />
    )
    expect(screen.getByText('Legal disclosures')).toBeInTheDocument()
    expect(screen.getByText('Manufacturer')).toBeInTheDocument()
    expect(screen.getByText('Acme, Pune')).toBeInTheDocument()
    expect(screen.getByText('Country of origin')).toBeInTheDocument()
    expect(screen.getByText('India')).toBeInTheDocument()
    // Packer has no value -> not rendered.
    expect(screen.queryByText('Packer')).not.toBeInTheDocument()
  })
})

describe('faqJsonLd', () => {
  it('returns null for no faqs', () => {
    expect(faqJsonLd([])).toBeNull()
  })

  it('builds FAQPage structured data from the faqs', () => {
    const ld = faqJsonLd([{ question: 'Q1', answer: 'A1' }])
    expect(ld).toMatchObject({
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Q1', acceptedAnswer: { '@type': 'Answer', text: 'A1' } }],
    })
  })
})
