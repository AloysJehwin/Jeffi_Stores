import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const queryMany = vi.fn()
vi.mock('@/lib/shared/db', () => ({ queryMany: (...a: any[]) => queryMany(...a) }))

import { CategoryFaqs, listCategoryFaqs } from '@/components/visitor/category/CategoryFaqs'

const faqs = [
  { id: '1', question: 'Do you ship?', answer: 'Yes,\nacross India.' },
  { id: '2', question: 'Returns?', answer: '7 days.' },
]

describe('CategoryFaqs', () => {
  beforeEach(() => queryMany.mockReset())

  it('renders nothing for an empty list', () => {
    const { container } = render(<CategoryFaqs faqs={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders each question/answer and FAQPage JSON-LD', () => {
    const { container } = render(<CategoryFaqs faqs={faqs} />)
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument()
    expect(screen.getByText('Do you ship?')).toBeInTheDocument()
    expect(screen.getByText(/across India/)).toBeInTheDocument()
    expect(container.querySelectorAll('details')).toHaveLength(2)
    const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!)
    expect(ld['@type']).toBe('FAQPage')
    expect(JSON.stringify(ld)).toContain('Returns?')
  })

  it('listCategoryFaqs queries published FAQs for the category', async () => {
    queryMany.mockResolvedValue(faqs)
    await expect(listCategoryFaqs('cat-9')).resolves.toEqual(faqs)
    expect(queryMany.mock.calls[0][0]).toContain('published = true')
    expect(queryMany.mock.calls[0][1]).toEqual(['cat-9'])
  })
})
