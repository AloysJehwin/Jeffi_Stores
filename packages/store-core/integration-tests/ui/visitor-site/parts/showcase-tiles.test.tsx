import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/visitor/site/code/common/tiles', () => ({
  CodeImage: ({ src, alt, aspect }: any) => <img src={src} alt={alt} data-aspect={aspect} />,
  CodeLink: ({ href, children, target, className }: any) => <a href={href} target={target} className={className}>{children}</a>,
}))

import { ServiceCard, WorkTile, TestimonialCard, StatTile, FaqList } from '@/components/visitor/site/code/parts/showcase/tiles'

describe('ServiceCard', () => {
  it('shows image, title, description and price', () => {
    render(<ServiceCard s={{ title: 'Haircut', description: 'A clean cut', price: 'From ₹300', image: '/h.jpg' } as any} />)
    expect(screen.getByRole('heading', { name: 'Haircut' })).toBeInTheDocument()
    expect(screen.getByText('A clean cut')).toBeInTheDocument()
    expect(screen.getByText('From ₹300')).toBeInTheDocument()
    expect(screen.getByAltText('Haircut')).toHaveAttribute('data-aspect', '4:3')
  })

  it('leaves out the parts a service lacks and honours a custom aspect', () => {
    render(<ServiceCard s={{ title: 'Consult', image: '/c.jpg' } as any} aspect="1:1" />)
    expect(screen.getByAltText('Consult')).toHaveAttribute('data-aspect', '1:1')
    expect(screen.queryByText(/₹/)).toBeNull()
    const { container } = render(<ServiceCard s={{ title: 'No image' } as any} />)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('WorkTile', () => {
  it('shows the picture with a caption, and links out when there is a link', () => {
    render(<WorkTile w={{ title: 'Kitchen', description: 'Oak fit-out', image: '/k.jpg', link: 'https://example.com/k' } as any} />)
    expect(screen.getByAltText('Kitchen')).toHaveAttribute('data-aspect', '1:1')
    expect(screen.getByText('Oak fit-out')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/k')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('is a plain figure without a link, with a fallback alt and no caption when untitled', () => {
    render(<WorkTile w={{ image: '/x.jpg' } as any} />)
    expect(screen.getByAltText('Our work')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })
})

describe('TestimonialCard', () => {
  it('shows the quote, name, source and stars', () => {
    const { container } = render(<TestimonialCard t={{ quote: 'Great service', name: 'Asha', source: 'Google', rating: 4, initial: 'A', avatar: null } as any} />)
    expect(screen.getByText('“Great service”')).toBeInTheDocument()
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByLabelText('4 out of 5')).toBeInTheDocument()
    expect(container.querySelectorAll('svg.fill-current')).toHaveLength(4)
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses the avatar when there is one and omits stars without a rating', () => {
    const { container } = render(<TestimonialCard t={{ quote: 'Nice', name: 'Ravi', avatar: '/r.jpg', initial: 'R', rating: null } as any} />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/r.jpg')
    expect(screen.queryByLabelText(/out of 5/)).toBeNull()
  })
})

describe('StatTile', () => {
  it('shows the figure and its label', () => {
    render(<StatTile s={{ value: '10k+', label: 'Happy clients' } as any} />)
    expect(screen.getByText('10k+')).toBeInTheDocument()
    expect(screen.getByText('Happy clients')).toBeInTheDocument()
  })
})

describe('FaqList', () => {
  const faqs = [{ question: 'Do you deliver?', answer: 'Yes, nationwide.' }, { question: 'Refunds?', answer: 'Within 7 days.' }] as any

  it('lists the questions as an accordion, opening the first when asked', () => {
    render(<FaqList faqs={faqs} multiple={false} defaultOpen />)
    expect(screen.getByRole('button', { name: 'Do you deliver?' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Refunds?' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Within 7 days.')).toBeInTheDocument()
  })

  it('opens an answer on click, closing the other one-at-a-time', () => {
    render(<FaqList faqs={faqs} multiple={false} defaultOpen />)
    fireEvent.click(screen.getByRole('button', { name: 'Refunds?' }))
    expect(screen.getByRole('button', { name: 'Refunds?' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Do you deliver?' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders nothing but the wrapper for no questions', () => {
    render(<FaqList faqs={[]} multiple defaultOpen={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
