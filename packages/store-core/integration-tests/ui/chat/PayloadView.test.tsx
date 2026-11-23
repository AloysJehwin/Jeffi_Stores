import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PayloadView from '@/components/chat/PayloadView'
import type { SupportPayload } from '@/lib/support/types'

describe('PayloadView', () => {
  it('renders nothing for an empty payload list', () => {
    const { container } = render(<PayloadView payloads={[]} />)
    expect(container.firstChild).toBeNull()
  })

  // ---- confirm card ----
  it('renders a pending confirm card with action buttons and fires onDecide', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined)
    const payloads: SupportPayload[] = [
      { type: 'confirm', actionId: 'act-1', title: 'Cancel order #42?', detail: 'This cannot be undone', confirmLabel: 'Yes, cancel', status: 'pending' },
    ]
    render(<PayloadView payloads={payloads} onDecide={onDecide} />)
    expect(screen.getByText('Cancel order #42?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Yes, cancel'))
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('act-1', 'confirm'))
  })

  it('decline button calls onDecide with "decline"', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined)
    render(
      <PayloadView
        payloads={[{ type: 'confirm', actionId: 'a9', title: 'Proceed?', status: 'pending' }]}
        onDecide={onDecide}
      />
    )
    fireEvent.click(screen.getByText('No, keep it'))
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('a9', 'decline'))
  })

  it('a settled confirm card shows status text instead of buttons', () => {
    render(<PayloadView payloads={[{ type: 'confirm', actionId: 'a', title: 'Done thing', status: 'done', resultText: 'Refunded' }]} onDecide={vi.fn()} />)
    expect(screen.getByText(/Done · Refunded/)).toBeInTheDocument()
    expect(screen.queryByText('Confirm')).toBeNull()
  })

  it('pending confirm with no onDecide shows a waiting note (customer-less view)', () => {
    render(<PayloadView payloads={[{ type: 'confirm', actionId: 'a', title: 'Hold on', status: 'pending' }]} />)
    expect(screen.getByText('Waiting for the customer to confirm')).toBeInTheDocument()
  })

  // ---- order cards ----
  it('renders order cards and links them via orderHref', () => {
    const payloads: SupportPayload[] = [
      {
        type: 'orders',
        orders: [{ id: 'o1', number: '1001', status: 'shipped', total: 2499, placedAt: '2026-01-02', items: '2 items' }],
      },
    ]
    render(<PayloadView payloads={payloads} orderHref={id => `/orders/${id}`} />)
    expect(screen.getByText('#1001')).toBeInTheDocument()
    expect(screen.getByText('shipped')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('₹2,499')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/orders/o1')
  })

  it('renders order cards as non-links when orderHref is absent', () => {
    render(
      <PayloadView
        payloads={[{ type: 'orders', orders: [{ id: 'o2', number: '9', status: 'cancelled', total: 10, placedAt: '2026-01-01' }] }]}
      />
    )
    expect(screen.getByText('#9')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  // ---- chips ----
  it('reply chips call onChip with the chip text', () => {
    const onChip = vi.fn()
    render(
      <PayloadView
        payloads={[{ type: 'chips', chips: [{ label: 'Track it', text: 'Where is my order?' }] }]}
        onChip={onChip}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Track it' }))
    expect(onChip).toHaveBeenCalledWith('Where is my order?')
  })

  it('chips are disabled when no onChip handler is given', () => {
    render(<PayloadView payloads={[{ type: 'chips', chips: [{ label: 'Hi', text: 'hi' }] }]} />)
    expect(screen.getByRole('button', { name: 'Hi' })).toBeDisabled()
  })

  // ---- links ----
  it('renders link cards with correct href and external target for http(s)', () => {
    render(
      <PayloadView
        payloads={[{ type: 'links', links: [{ label: 'Policy', href: 'https://example.com/policy' }] }]}
      />
    )
    const link = screen.getByRole('link', { name: /Policy/ })
    expect(link).toHaveAttribute('href', 'https://example.com/policy')
    expect(link).toHaveAttribute('target', '_blank')
  })
})
