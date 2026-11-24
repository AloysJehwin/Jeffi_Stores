import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/visitor/CategoryIcon', () => ({ default: ({ categoryName }: any) => <i data-testid="icon">{categoryName}</i> }))

import CategoryOffer, { type OfferCategory } from '@/components/visitor/CategoryOffer'

const cats: OfferCategory[] = [
  {
    id: 'c1',
    name: 'Audio',
    slug: 'audio',
    icon_name: 'headphones',
    subcategories: [
      { id: 's1', name: 'Speakers', slug: 'speakers' },
      { id: 's2', name: 'Misc', slug: null },
    ],
  },
  { id: 'c2', name: 'Cables', slug: null, icon_name: null, subcategories: [] },
]

describe('CategoryOffer', () => {
  it('renders a card per category with links and subcategory counts', () => {
    render(<CategoryOffer categories={cats} />)
    expect(screen.getByRole('link', { name: /Audio/ })).toHaveAttribute('href', '/categories/audio')
    expect(screen.getByText('2 subcategories')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cables/ })).toHaveAttribute('href', '/categories')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('expands and collapses subcategory links', () => {
    render(<CategoryOffer categories={cats} />)
    expect(screen.queryByRole('link', { name: 'Speakers' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Audio' }))
    expect(screen.getByRole('link', { name: 'Speakers' })).toHaveAttribute('href', '/categories/speakers')
    expect(screen.getByRole('link', { name: 'Misc' })).toHaveAttribute('href', '/categories')
    const btn = screen.getByRole('button', { name: 'Collapse Audio' })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(btn)
    expect(screen.queryByRole('link', { name: 'Speakers' })).not.toBeInTheDocument()
  })

  it('renders an empty grid for no categories', () => {
    const { container } = render(<CategoryOffer categories={[]} />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
