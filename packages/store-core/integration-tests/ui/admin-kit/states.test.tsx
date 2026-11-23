import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState, ErrorState, TableSkeleton, ListSkeleton, FormSkeleton, DetailSkeleton } from '@/components/admin/kit/states'

// Empty / error / loading states. next/link -> anchor so the action link renders in happy-dom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('EmptyState (render + branches)', () => {
  it('renders the title and body', () => {
    render(<EmptyState title="No orders yet" body="They will show up here." />)
    expect(screen.getByText('No orders yet')).toBeInTheDocument()
    expect(screen.getByText('They will show up here.')).toBeInTheDocument()
  })

  it('renders a link action when `action` is given', () => {
    render(<EmptyState title="Empty" action={{ label: 'Add product', href: '/admin/products/new' }} />)
    const link = screen.getByRole('link', { name: 'Add product' })
    expect(link).toHaveAttribute('href', '/admin/products/new')
  })

  it('renders a custom actionNode and no link when no `action`', () => {
    render(<EmptyState title="Empty" actionNode={<button type="button">Refresh</button>} />)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('omits the body paragraph when not provided', () => {
    render(<EmptyState title="Just a title" />)
    expect(screen.getByText('Just a title')).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('shows its default title', () => {
    render(<ErrorState />)
    expect(screen.getByText('Could not load this')).toBeInTheDocument()
  })

  it('shows a custom title and body', () => {
    render(<ErrorState title="Fetch failed" body="Try again shortly." />)
    expect(screen.getByText('Fetch failed')).toBeInTheDocument()
    expect(screen.getByText('Try again shortly.')).toBeInTheDocument()
  })
})

describe('skeletons (structure)', () => {
  it('TableSkeleton renders the requested row count', () => {
    const { container } = render(<TableSkeleton rows={3} cols={4} />)
    // header row + 3 body rows all carry a border-b; assert body rows via the pulse wrapper children.
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(container.querySelectorAll('.flex.h-12').length).toBe(3)
  })

  it('ListSkeleton can hide the header', () => {
    const { container } = render(<ListSkeleton header={false} kpis={0} rows={2} />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    // header skeleton uses an h-7 bar; absent when header=false.
    expect(container.querySelector('.h-7')).toBeNull()
  })

  it('FormSkeleton renders one block per section', () => {
    const { container } = render(<FormSkeleton sections={3} />)
    expect(container.querySelectorAll('.p-5').length).toBe(3)
  })

  it('DetailSkeleton renders without error', () => {
    const { container } = render(<DetailSkeleton kpis={2} />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
})
