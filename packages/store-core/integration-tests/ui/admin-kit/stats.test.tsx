import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PctBadge, GroupLabel, MiniStat, CompactStat, ListRows } from '@/components/admin/kit/stats'

// next/link -> anchor so linked stat rows render (and expose href) in happy-dom.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

describe('PctBadge (branches)', () => {
  it('renders a dash for a null value', () => {
    render(<PctBadge value={null} />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('shows the absolute percent for a positive change', () => {
    render(<PctBadge value={12} />)
    expect(screen.getByText('12%')).toBeInTheDocument()
  })

  it('shows the magnitude (no sign) for a negative change', () => {
    render(<PctBadge value={-8} />)
    expect(screen.getByText('8%')).toBeInTheDocument()
  })
})

describe('GroupLabel', () => {
  it('renders the title and optional hint', () => {
    render(<GroupLabel title="Revenue" hint="last 30 days" />)
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('last 30 days')).toBeInTheDocument()
  })
})

describe('MiniStat (branches)', () => {
  it('renders label and value as a plain row without href', () => {
    render(<MiniStat label="Orders" value="42" />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders as a link and shows a sub line when href + sub given', () => {
    render(<MiniStat label="Revenue" value="Rs 1,200" href="/admin/revenue" sub="12 sales" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/revenue')
    expect(screen.getByText('12 sales')).toBeInTheDocument()
  })
})

describe('CompactStat (branches)', () => {
  it('renders label, value and a pct badge when pct is provided', () => {
    render(<CompactStat label="AOV" value="Rs 900" pct={5} />)
    expect(screen.getByText('AOV')).toBeInTheDocument()
    expect(screen.getByText('Rs 900')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
  })

  it('omits the pct badge entirely when pct is undefined', () => {
    render(<CompactStat label="Visits" value="300" />)
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.queryByText('%', { exact: false })).toBeNull()
  })

  it('renders as a link when href is set', () => {
    render(<CompactStat label="Clicks" value="10" href="/admin/clicks" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/clicks')
  })
})

describe('ListRows (branches)', () => {
  it('renders an empty message when there are no rows', () => {
    render(<ListRows rows={[]} />)
    expect(screen.getByText('No data yet.')).toBeInTheDocument()
  })

  it('renders a linked row with primary, secondary and value', () => {
    render(
      <ListRows
        rows={[{ key: 'a', primary: 'Widget', secondary: 'SKU-1', value: 'Rs 99', href: '/admin/products/a' }]}
      />
    )
    expect(screen.getByText('Widget')).toBeInTheDocument()
    expect(screen.getByText('SKU-1')).toBeInTheDocument()
    expect(screen.getByText('Rs 99')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/products/a')
  })
})
