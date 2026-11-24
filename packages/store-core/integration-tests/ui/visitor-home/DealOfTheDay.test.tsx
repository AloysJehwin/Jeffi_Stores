import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/visitor/ProductCard', () => ({
  default: ({ id, name, portal }: any) => <div data-testid="product" data-id={id} data-portal={portal}>{name}</div>,
}))
vi.mock('@/components/visitor/home/DealCountdown', () => ({
  default: ({ endsAt }: { endsAt: string }) => <div data-testid="countdown">{endsAt}</div>,
}))
vi.mock('@/lib/catalog/product-card-props', () => ({
  productCardProps: (p: any) => ({ id: p.id, name: p.name }),
}))

import DealOfTheDay from '@/components/visitor/home/DealOfTheDay'

afterEach(() => vi.useRealTimers())

const products = [{ id: 'a', name: 'Drill' }, { id: 'b', name: 'Saw' }]

describe('DealOfTheDay', () => {
  it('shows the default copy and every product', () => {
    render(<DealOfTheDay products={products} gstEnabled />)
    expect(screen.getByRole('heading', { level: 2, name: 'Deal of the Day' })).toBeInTheDocument()
    expect(screen.getByText('Limited Time')).toBeInTheDocument()
    expect(screen.getAllByTestId('product')).toHaveLength(2)
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('uses custom title and eyebrow and forwards the portal', () => {
    render(<DealOfTheDay products={products} gstEnabled={false} title="Flash sale" eyebrow="Today" portal="business" />)
    expect(screen.getByRole('heading', { name: 'Flash sale' })).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getAllByTestId('product')[0].dataset.portal).toBe('business')
  })

  it('shows the countdown only for a future deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { rerender } = render(<DealOfTheDay products={products} gstEnabled countdownEndsAt="2026-01-02T00:00:00Z" />)
    expect(screen.getByTestId('countdown')).toHaveTextContent('2026-01-02T00:00:00Z')
    rerender(<DealOfTheDay products={products} gstEnabled countdownEndsAt="2025-12-31T00:00:00Z" />)
    expect(screen.queryByTestId('countdown')).toBeNull()
  })

  it('renders the heading with no cards when there are no products', () => {
    render(<DealOfTheDay products={[]} gstEnabled />)
    expect(screen.getByRole('heading', { name: 'Deal of the Day' })).toBeInTheDocument()
    expect(screen.queryByTestId('product')).toBeNull()
  })
})
