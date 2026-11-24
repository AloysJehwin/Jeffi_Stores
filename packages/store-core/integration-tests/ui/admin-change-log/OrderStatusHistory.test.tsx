import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))

import OrderStatusHistory from '@/components/admin/change-log/OrderStatusHistory'

const item = (id: string, at: string, action: string, changes: { field: string; from: unknown; to: unknown }[], name = 'Asha') => ({
  id,
  at,
  actor: { kind: 'admin', name },
  summary: null,
  parts: [{ entityType: 'orders', entityId: 'o1', action, changes }],
})

describe('OrderStatusHistory', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows loading, then placed and status steps with who made them', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          item('2', '2026-03-02T10:00:00Z', 'update', [{ field: 'status', from: 'pending', to: 'shipped' }]),
          item('1', '2026-03-01T10:00:00Z', 'create', [], 'Customer'),
        ],
        next: null,
      }),
    })
    render(<OrderStatusHistory orderId="o1" />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('Order placed')).toBeInTheDocument()
    expect(screen.getByText('Order')).toBeInTheDocument()
    expect(screen.getByText(/Asha ·/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain('kind=order&id=o1')
  })

  it('falls back to the placed date when the log has no rows', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], next: null }) })
    render(<OrderStatusHistory orderId="o1" placedAt="2026-03-01T10:00:00Z" />)
    expect(await screen.findByText('Order placed')).toBeInTheDocument()
  })

  it('shows the empty message with nothing to show', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], next: null }) })
    render(<OrderStatusHistory orderId="o1" />)
    expect(await screen.findByText('No status changes recorded yet.')).toBeInTheDocument()
  })

  it('offers a retry after a failed load', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], next: null }) })
    render(<OrderStatusHistory orderId="o1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('No status changes recorded yet.')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
