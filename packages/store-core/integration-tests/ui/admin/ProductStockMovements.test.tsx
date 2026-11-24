import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/shared/admin-path', () => ({ ap: (p: string) => p }))
vi.mock('@/lib/client/agent-events', () => ({ useAgentChanges: () => {} }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

import ProductStockMovements from '@/components/admin/ProductStockMovements'

const tx = (o: Record<string, any> = {}) => ({
  id: 't1', created_at: '2026-11-10T08:30:00Z', transaction_type: 'sale', quantity_change: -2, quantity_after: 8,
  reference_type: 'order', reference_id: 'o9', reference_label: 'ORD-9', notes: 'Shipped', variant_name: 'Red',
  serial_number: null, lot_number: null, expiry_date: null, ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()
const page = (transactions: any[], total = transactions.length) => ({ ok: true, json: async () => ({ transactions, total }) })

beforeEach(() => vi.stubGlobal('fetch', fetchMock))

describe('ProductStockMovements', () => {
  it('is collapsed and does not fetch until opened', () => {
    render(<ProductStockMovements productId="p1" />)
    expect(screen.getByText('Stock Movements')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the ledger for the product and renders the rows', async () => {
    fetchMock.mockResolvedValue(page([
      tx(),
      tx({ id: 't2', transaction_type: 'purchase', quantity_change: 5, quantity_after: null, reference_type: 'grn', reference_label: null, variant_name: null, lot_number: 'LOT7', expiry_date: '2027-01-05', notes: null }),
      tx({ id: 't3', transaction_type: 'adjustment', quantity_change: -1, reference_type: 'stock_take', reference_id: null, serial_number: 'SN-1' }),
    ]))
    render(<ProductStockMovements productId="p1" />)
    fireEvent.click(screen.getByText('Stock Movements'))
    expect(await screen.findByText('Sale')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain('/api/admin/inventory/stock?')
    expect(fetchMock.mock.calls[0][0]).toContain('product_id=p1')
    expect(fetchMock.mock.calls[0][0]).toContain('view=ledger')
    expect(screen.getByText('ORD-9').closest('a')).toHaveAttribute('href', '/admin/orders/o9/view')
    expect(screen.getByText('-2')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('Purchase')).toBeInTheDocument()
    expect(screen.getByText('GRN')).toBeInTheDocument()
    expect(screen.getByText('LOT7')).toBeInTheDocument()
    expect(screen.getByText(/Exp:/)).toBeInTheDocument()
    expect(screen.getByText('SN-1')).toBeInTheDocument()
    expect(screen.getByText('stock take')).toBeInTheDocument()
    expect(screen.getAllByText('Red')).toHaveLength(2)
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValue(page([]))
    render(<ProductStockMovements productId="p1" />)
    fireEvent.click(screen.getByText('Stock Movements'))
    expect(await screen.findByText('No stock movements recorded.')).toBeInTheDocument()
  })

  it('shows an error with Retry that reloads', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Ledger down' }) })
    render(<ProductStockMovements productId="p1" />)
    fireEvent.click(screen.getByText('Stock Movements'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ledger down')
    fetchMock.mockResolvedValueOnce(page([tx()]))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Sale')).toBeInTheDocument()
  })

  it('collapses again on a second click', async () => {
    fetchMock.mockResolvedValue(page([tx()]))
    render(<ProductStockMovements productId="p1" />)
    fireEvent.click(screen.getByText('Stock Movements'))
    await screen.findByText('Sale')
    fireEvent.click(screen.getByText('Stock Movements'))
    expect(screen.queryByText('Sale')).not.toBeInTheDocument()
  })
})
