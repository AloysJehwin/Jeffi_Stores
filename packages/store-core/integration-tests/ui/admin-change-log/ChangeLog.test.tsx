import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))

import ChangeLog, { ChangeEntry } from '@/components/admin/change-log/ChangeLog'

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  at: '2026-03-02T10:00:00Z',
  actor: { kind: 'admin', name: 'Asha Rao' },
  summary: null,
  parts: [{ entityType: 'products', entityId: 'p1', action: 'update', changes: [{ field: 'selling_price', from: 100, to: 120 }] }],
  ...over,
})
const page = (items: unknown[], next: string | null = null) => ({ ok: true, json: async () => ({ items, next }) })

describe('ChangeEntry', () => {
  it('shows actor, field changes and collapses long lists', () => {
    const changes = Array.from({ length: 8 }, (_, i) => ({ field: `field_${i}`, from: `a${i}`, to: `b${i}` }))
    render(<ul><ChangeEntry noun="product" item={entry('1', { parts: [{ entityType: 'products', entityId: 'p1', action: 'update', changes }] }) as never} /></ul>)
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
    fireEvent.click(screen.getByText('+2 more'))
    expect(screen.getByText('Show less')).toBeInTheDocument()
  })

  it('shows a headline for a creation and child rows', () => {
    render(
      <ul>
        <ChangeEntry
          noun="order"
          item={entry('2', {
            actor: { kind: 'source', name: 'Razorpay' },
            parts: [
              { entityType: 'orders', entityId: 'o1', action: 'create', changes: [] },
              { entityType: 'order_items', entityId: 'i1', action: 'create', child: { label: 'Item', name: 'Drill' }, changes: [] },
            ],
          }) as never}
        />
      </ul>
    )
    expect(screen.getByText('Razorpay')).toBeInTheDocument()
    expect(screen.getByText('“Drill”')).toBeInTheDocument()
  })
})

describe('ChangeLog', () => {
  let fetchMock: ReturnType<typeof vi.fn<(...a: any[]) => any>>
  beforeEach(() => {
    fetchMock = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('plain variant loads and lists entries, with an empty state', async () => {
    fetchMock.mockResolvedValue(page([entry('1')]))
    const { unmount } = render(<ChangeLog kind="product" id="p1" variant="plain" />)
    expect(screen.getByText('Loading changes…')).toBeInTheDocument()
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain('kind=product&id=p1')
    unmount()
    fetchMock.mockResolvedValue(page([]))
    render(<ChangeLog kind="product" id="p1" variant="plain" />)
    expect(await screen.findByText('No changes recorded yet.')).toBeInTheDocument()
  })

  it('card variant stays closed and does not fetch until opened', async () => {
    fetchMock.mockResolvedValue(page([entry('1')]))
    render(<ChangeLog kind="order" id="o1" title="History" />)
    expect(fetchMock).not.toHaveBeenCalled()
    const toggle = screen.getByRole('button', { name: /History/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('product preset chips filter the entries', async () => {
    fetchMock.mockResolvedValue(
      page([
        entry('1'),
        entry('2', { actor: { kind: 'admin', name: 'Ravi K' }, parts: [{ entityType: 'products', entityId: 'p1', action: 'update', changes: [{ field: 'name', from: 'a', to: 'b' }] }] }),
      ])
    )
    render(<ChangeLog kind="product" id="p1" variant="plain" preset="product" />)
    await screen.findByText('Asha Rao')
    expect(screen.getByText('Ravi K')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Price & stock' }))
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.queryByText('Ravi K')).not.toBeInTheDocument()
  })

  it('shows a retry when loading fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    fetchMock.mockResolvedValueOnce(page([entry('1')]))
    render(<ChangeLog kind="product" id="p1" variant="plain" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
  })

  it('compact variant shows one line per change and opens the full log in a sheet', async () => {
    fetchMock.mockResolvedValue(page([entry('1')]))
    render(<ChangeLog kind="product" id="p1" variant="compact" />)
    expect(await screen.findByText(/Selling price → /)).toBeInTheDocument()
    expect(screen.getByText('Recent changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    await waitFor(() => expect(screen.getByText('Who changed what, and when')).toBeInTheDocument())
  })
})
