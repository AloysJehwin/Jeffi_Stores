import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock ProductCard (its own heavy render is tested elsewhere) and next/link. We test CategoryTabs' own
// behaviour: tab roles, the active panel's products, and switching the active tab on click + arrow keys.
vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ id }: { id: string }) => <div data-testid="product" data-id={id} />,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import CategoryTabs from '@/components/visitor/home/CategoryTabs'

const tabs = [
  {
    id: 'tools',
    name: 'Tools',
    slug: 'tools',
    products: [{ id: 'p1' } as any, { id: 'p2' } as any],
  },
  {
    id: 'paint',
    name: 'Paint',
    slug: 'paint',
    products: [{ id: 'p3' } as any],
  },
]

describe('CategoryTabs (render + interaction)', () => {
  it('renders a tab per category and the first tab active with its products', () => {
    render(<CategoryTabs tabs={tabs} />)
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'false')
    // First tab's two products shown.
    expect(screen.getAllByTestId('product')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /View all Tools/ })).toHaveAttribute(
      'href',
      '/products?category=tools'
    )
  })

  it('switches the active tab and panel on click', () => {
    render(<CategoryTabs tabs={tabs} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Paint' }))
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByTestId('product')).toHaveLength(1) // paint has one product
    expect(screen.getByRole('link', { name: /View all Paint/ })).toHaveAttribute(
      'href',
      '/products?category=paint'
    )
  })

  it('moves the active tab with the right-arrow key', () => {
    render(<CategoryTabs tabs={tabs} />)
    const tablist = screen.getByRole('tablist')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'true')
  })
})
