import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/components/admin/AdminAgentBlocks', () => ({
  default: ({ blocks }: any) => <div data-testid="blocks">{blocks.length} preview blocks</div>,
}))

import ProposedActionCard, { splitProposalBlocks, describeResult } from '@/components/admin/agent/ProposedActionCard'

const action = (o: any = {}) => ({ id: 'a1', kind: 'create_quotation', payload: {}, confirmation: 'Create this quotation?', status: 'proposed', ...o })

describe('ProposedActionCard', () => {
  it('proposed: shows the kind, state, confirmation and Approve / Reject', () => {
    const onDecide = vi.fn()
    render(<ProposedActionCard action={action() as any} onDecide={onDecide} />)
    expect(screen.getByText('Create quotation')).toBeInTheDocument()
    expect(screen.getByText('Needs approval')).toBeInTheDocument()
    expect(screen.getByText('Create this quotation?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(onDecide).toHaveBeenLastCalledWith('approve')
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    expect(onDecide).toHaveBeenLastCalledWith('reject')
  })

  it('wraps the buttons with the page gate', () => {
    render(<ProposedActionCard action={action() as any} onDecide={() => {}} approveWrapper={n => <div data-testid="gate">{n}</div>} />)
    expect(screen.getByTestId('gate')).toContainElement(screen.getByRole('button', { name: /Approve/ }))
  })

  it('renders its preview blocks', () => {
    render(<ProposedActionCard action={action() as any} blocks={[{ type: 'document' }, { type: 'change_summary' }] as any} onDecide={() => {}} />)
    expect(screen.getByTestId('blocks')).toHaveTextContent('2 preview blocks')
  })

  it('approving: says Executing or Rejecting and hides the buttons', () => {
    const { rerender } = render(<ProposedActionCard action={action({ status: 'approving', decision: 'approve' }) as any} onDecide={() => {}} />)
    expect(screen.getByText('Executing…')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ProposedActionCard action={action({ status: 'approving', decision: 'reject' }) as any} onDecide={() => {}} />)
    expect(screen.getByText('Rejecting…')).toBeInTheDocument()
  })

  it('approved: shows Executed with a summary and an outcome link', () => {
    render(<ProposedActionCard action={action({ status: 'approved', result: { quotationId: 'q9', quoteNumber: 'QT-9', total: 1180 } }) as any} onDecide={() => {}} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Executed').parentElement).toHaveTextContent('Quotation QT-9 created · ₹1,180.00')
    expect(screen.getByRole('link', { name: /Open quotation/ })).toHaveAttribute('href', '/admin/quotations/q9')
  })

  it('failed: shows the error or a fallback', () => {
    const { rerender } = render(<ProposedActionCard action={action({ status: 'failed', error: 'Out of stock' }) as any} onDecide={() => {}} />)
    expect(screen.getByText('Failed', { selector: 'span.font-semibold' })).toBeInTheDocument()
    expect(screen.getByText(/Out of stock/)).toBeInTheDocument()
    rerender(<ProposedActionCard action={action({ status: 'failed' }) as any} onDecide={() => {}} />)
    expect(screen.getByText(/unknown error/)).toBeInTheDocument()
  })

  it('rejected: says nothing was changed', () => {
    render(<ProposedActionCard action={action({ status: 'rejected' }) as any} onDecide={() => {}} />)
    expect(screen.getByText('Rejected', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/nothing was changed/)).toBeInTheDocument()
  })
})

describe('splitProposalBlocks', () => {
  const doc = { type: 'document' } as any
  const text = { type: 'text' } as any
  const chg = { type: 'change_summary' } as any

  it('keeps an action’s own blocks and leaves the rest', () => {
    const own = { type: 'document', id: 'own' } as any
    const r = splitProposalBlocks([text], [{ id: 'a', blocks: [own] } as any])
    expect(r.byAction.a).toEqual([own])
    expect(r.rest).toEqual([text])
  })

  it('moves every preview block into a single action', () => {
    const r = splitProposalBlocks([text, doc, chg], [{ id: 'a' } as any])
    expect(r.byAction.a).toEqual([doc, chg])
    expect(r.rest).toEqual([text])
  })

  it('maps by order when counts match, and leaves them when they do not', () => {
    const r = splitProposalBlocks([doc, chg], [{ id: 'a' }, { id: 'b' }] as any)
    expect(r.byAction.a).toEqual([doc])
    expect(r.byAction.b).toEqual([chg])
    const r2 = splitProposalBlocks([doc], [{ id: 'a' }, { id: 'b' }] as any)
    expect(r2.rest).toEqual([doc])
    expect(r2.byAction).toEqual({})
  })

  it('tolerates undefined inputs', () => {
    expect(splitProposalBlocks(undefined, undefined)).toEqual({ rest: [], byAction: {} })
  })
})

describe('describeResult', () => {
  it('returns null for a non-object result', () => {
    expect(describeResult('x', null)).toBeNull()
    expect(describeResult('x', 'ok')).toBeNull()
  })

  it('describes invoices, orders, products and customers with links', () => {
    expect(describeResult('x', { invoiceId: 'i1', invoiceNumber: 'INV-1', total: 100 })).toEqual({ text: 'Invoice INV-1 · ₹100.00', href: '/admin/invoices/i1/view', linkLabel: 'Open invoice' })
    expect(describeResult('x', { orderId: 'o1', orderNumber: '1042' })).toMatchObject({ text: 'Order 1042', href: '/admin/orders/o1/view', linkLabel: 'Open order' })
    expect(describeResult('update_product', { id: 'p1', name: 'Shirt', summary: 'Price changed' })).toMatchObject({ text: 'Price changed · Shirt', href: '/admin/products/p1' })
    expect(describeResult('x', { customerId: 'c1', title: 'Priya' })).toMatchObject({ href: '/admin/customers/c1/view', linkLabel: 'Open customer' })
  })

  it('falls back to a summary, sent-to and code, and only keeps /admin links', () => {
    expect(describeResult('x', { summary: 'Sent', sentTo: 'a@b.in', code: 'SAVE10' })).toEqual({ text: 'Sent · Sent to a@b.in · Code SAVE10', href: undefined })
    expect(describeResult('x', { href: '/admin/coupons/1' })).toMatchObject({ href: '/admin/coupons/1' })
    expect(describeResult('x', { href: 'https://evil.example' })).toMatchObject({ href: undefined })
  })
})
