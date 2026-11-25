import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/CategoryIcon', () => ({
  default: ({ iconName, categoryName }: any) => <i data-testid="icon" data-icon={iconName} data-cat={categoryName} />,
}))
vi.mock('@/components/visitor/SectionCarousel', () => ({
  default: ({ children, ariaLabel }: any) => <div data-testid="carousel" aria-label={ariaLabel}>{children}</div>,
}))

import CategoryGrid from '@/components/visitor/home/CategoryGrid'

const categories = [
  { id: '1', name: 'Tools', slug: 'tools', icon_name: 'Wrench', image_url: null },
  { id: '2', name: 'Paint', slug: 'paint', image_url: 'https://cdn.test/paint.jpg' },
]

describe('CategoryGrid', () => {
  it('links each category and shows its image or icon', () => {
    const { container } = render(<CategoryGrid categories={categories} />)
    expect(screen.getByRole('heading', { name: 'Shop by Category' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tools/ })).toHaveAttribute('href', '/categories/tools')
    expect(screen.getByRole('link', { name: /Paint/ })).toHaveAttribute('href', '/categories/paint')
    expect(screen.getByTestId('icon')).toHaveAttribute('data-icon', 'Wrench')
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/paint.jpg')
    expect(screen.getByRole('link', { name: /View All/ })).toHaveAttribute('href', '/categories')
  })

  it('applies a tile aspect ratio when given', () => {
    const { container } = render(<CategoryGrid categories={categories} aspect={1.5} />)
    expect(container.querySelector('.shape-box')).toHaveStyle({ aspectRatio: '1.5' })
  })

  it('uses the carousel with custom copy', () => {
    render(<CategoryGrid categories={categories} carousel title="Aisles" eyebrow="Browse" />)
    expect(screen.getByTestId('carousel')).toHaveAttribute('aria-label', 'Aisles')
    expect(screen.getByText('Browse')).toBeInTheDocument()
  })

  it('renders no tiles for no categories', () => {
    render(<CategoryGrid categories={[]} />)
    expect(screen.queryByTestId('icon')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Shop by Category' })).toBeInTheDocument()
  })
})
