import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResponsiveList from '@/components/admin/ResponsiveList'

const items = [{ id: 1, n: 'Alpha' }, { id: 2, n: 'Beta' }]
const base = {
  getKey: (i: { id: number }) => i.id,
  renderCard: (i: { n: string }) => <div>card-{i.n}</div>,
  tableHead: <th>Name</th>,
  tableBody: <tbody><tr><td>row-data</td></tr></tbody>,
}

describe('ResponsiveList', () => {
  it('renders a card per item (mobile) and the table (desktop)', () => {
    render(<ResponsiveList items={items} {...base} />)
    expect(screen.getByText('card-Alpha')).toBeInTheDocument()
    expect(screen.getByText('card-Beta')).toBeInTheDocument()
    expect(screen.getByText('row-data')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('table').className).toMatch(/min-w-\[900px\]/)
  })

  it('lets mobileList replace the default cards', () => {
    render(<ResponsiveList items={items} {...base} mobileList={<div>custom-mobile</div>} />)
    expect(screen.getByText('custom-mobile')).toBeInTheDocument()
    expect(screen.queryByText('card-Alpha')).not.toBeInTheDocument()
  })

  it('shows the default empty state when there are no items', () => {
    render(<ResponsiveList items={[]} {...base} />)
    expect(screen.getByText('No results found.')).toBeInTheDocument()
  })

  it('shows a custom empty state, or none when the caller owns it', () => {
    const { rerender } = render(<ResponsiveList items={[]} {...base} emptyState={<p>Nothing here</p>} />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    rerender(<ResponsiveList items={[]} {...base} hasOwnEmptyState />)
    expect(screen.queryByText('No results found.')).not.toBeInTheDocument()
  })

  it('renders pagination on both layouts and honours minWidth', () => {
    render(<ResponsiveList items={items} {...base} pagination={<span>pager</span>} minWidth="none" />)
    expect(screen.getAllByText('pager')).toHaveLength(2)
    expect(screen.getByRole('table').className).not.toMatch(/min-w-/)
  })
})
