import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import ChangeSummaryBlock, { type ChangeSummaryBlockData } from '@/components/admin/agent/ChangeSummaryBlock'

const base: ChangeSummaryBlockData = {
  type: 'change_summary',
  title: 'Update order status',
  subject: { label: 'Order #1042', href: '/admin/orders/1042/view', meta: 'Priya S.' },
  changes: [
    { field: 'Status', from: 'Pending', to: 'Shipped', tone: 'success' },
    { field: 'Courier', to: 'Delhivery' },
  ],
  effects: ['Customer is emailed', 'Stock is reserved'],
  warnings: ['Cannot be undone'],
  requires: 'orders.write',
}

describe('ChangeSummaryBlock', () => {
  it('shows the title, linked subject with meta and the requires chip', () => {
    render(<ChangeSummaryBlock block={base} />)
    expect(screen.getByText('Update order status')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Order #1042' })).toHaveAttribute('href', '/admin/orders/1042/view')
    expect(screen.getByText(/Priya S\./)).toBeInTheDocument()
    expect(screen.getByTitle('Requires orders.write')).toHaveTextContent('orders.write')
  })

  it('renders from and to for each change, and only to when there is no from', () => {
    render(<ChangeSummaryBlock block={base} />)
    const items = screen.getAllByRole('listitem')
    const status = items.find(li => li.textContent?.includes('Status'))!
    expect(status).toHaveTextContent('Pending')
    expect(status).toHaveTextContent('Shipped')
    expect(screen.getByLabelText('to')).toBeInTheDocument()
    const courier = items.find(li => li.textContent?.includes('Courier'))!
    expect(courier).toHaveTextContent('Delhivery')
    expect(courier.querySelector('[aria-label="to"]')).toBeNull()
    expect(screen.getByText('Shipped')).toHaveClass('text-green-700')
  })

  it('lists effects under On approval and the warnings', () => {
    render(<ChangeSummaryBlock block={base} />)
    expect(screen.getByText('On approval')).toBeInTheDocument()
    expect(screen.getByText('Customer is emailed')).toBeInTheDocument()
    expect(screen.getByText('Stock is reserved')).toBeInTheDocument()
    expect(screen.getByText('Cannot be undone')).toBeInTheDocument()
  })

  it('renders an unlinked subject as plain text and omits optional sections', () => {
    render(<ChangeSummaryBlock block={{ type: 'change_summary', title: 'Rename', subject: { label: 'Shirt' }, changes: [{ field: 'Name', from: '', to: 'Tee' }] }} />)
    expect(screen.getByText('Shirt').closest('a')).toBeNull()
    expect(screen.queryByText('On approval')).toBeNull()
    expect(screen.queryByTitle(/Requires/)).toBeNull()
    expect(screen.queryByLabelText('to')).toBeNull()
  })

  it('tolerates missing arrays', () => {
    render(<ChangeSummaryBlock block={{ type: 'change_summary', title: 'Empty' } as any} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })
})
