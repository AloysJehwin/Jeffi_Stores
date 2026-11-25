import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

let scanner: { onScan: (c: string) => void; enabled: boolean }
vi.mock('@/hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: (o: any) => {
    scanner = o
  },
}))

import BatchPickerModal, { expiryColor, initSelections, type BatchPickerItem } from '@/components/admin/BatchPickerModal'

const day = 86400000
const iso = (offset: number) => new Date(Date.now() + offset * day).toISOString()

const batch = (id: string, lot: string | null, qty: number, expiry: string | null = null, location: string | null = null) => ({
  id,
  lot_number: lot,
  manufacture_date: null,
  expiry_date: expiry,
  quantity_remaining: qty,
  location,
})

const item = (over: Partial<BatchPickerItem> = {}): BatchPickerItem => ({
  order_item_id: 'oi1',
  product_name: 'Paracetamol',
  variant_name: '500mg',
  required_qty: 15,
  already_assigned: false,
  batches: [batch('b1', 'LOT-A', 10, iso(3), 'R1'), batch('b2', 'LOT-B', 20, iso(100)), batch('b3', null, 5)],
  ...over,
})

describe('expiryColor', () => {
  it('colours by days to expiry', () => {
    expect(expiryColor(null)).toBe('text-foreground-muted')
    expect(expiryColor(iso(-2))).toContain('text-red-500')
    expect(expiryColor(iso(3))).toContain('text-orange-500')
    expect(expiryColor(iso(20))).toContain('text-yellow-600')
    expect(expiryColor(iso(90))).toBe('text-green-600')
  })
})

describe('initSelections', () => {
  it('allocates FIFO across batches up to the requirement', () => {
    expect(initSelections(item())).toEqual({ b1: 10, b2: 5 })
  })
  it('stops when the stock runs out', () => {
    expect(initSelections(item({ required_qty: 100 }))).toEqual({ b1: 10, b2: 20, b3: 5 })
  })
  it('skips empty batches', () => {
    expect(initSelections(item({ batches: [batch('x', 'X', 0), batch('y', 'Y', 4)], required_qty: 3 }))).toEqual({ y: 3 })
  })
})

describe('BatchPickerModal', () => {
  beforeEach(() => {
    scanner = { onScan: () => {}, enabled: false }
  })

  const mount = (items = [item()]) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const view = render(<BatchPickerModal items={items} onConfirm={onConfirm} onCancel={onCancel} />)
    return { onConfirm, onCancel, ...view }
  }

  it('lists the item, requirement, batches, FIFO tag and the auto allocation', () => {
    mount()
    expect(screen.getByText('Paracetamol / 500mg')).toBeInTheDocument()
    expect(screen.getByText('Required: 15 units')).toBeInTheDocument()
    expect(screen.getByText('15 / 15')).toBeInTheDocument()
    expect(screen.getByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('FIFO')).toBeInTheDocument()
    expect(screen.getByText('R1')).toBeInTheDocument()
    expect(screen.getAllByText('⚠ low')).toHaveLength(2)
    expect(screen.getAllByRole('checkbox').map(c => (c as HTMLInputElement).checked)).toEqual([true, true, false])
  })

  it('confirms the FIFO assignments', () => {
    const { onConfirm } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Batch Assignment' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { order_item_id: 'oi1', batch_id: 'b1', qty: 10 },
      { order_item_id: 'oi1', batch_id: 'b2', qty: 5 },
    ])
  })

  it('unchecking a batch leaves a shortfall and blocks confirming', () => {
    mount()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByText('5 / 15')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Batch Assignment' })).toBeDisabled()
  })

  it('checking a batch tops up only what is still needed', () => {
    mount()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('10 / 15')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox')[2])
    expect(screen.getByText('15 / 15')).toBeInTheDocument()
  })

  it('clicking a row toggles it', () => {
    mount()
    fireEvent.click(screen.getByText('LOT-B').closest('tr')!)
    expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked()
  })

  it('stepper buttons and typing change the take, capped at availability', () => {
    mount()
    const inputs = () => screen.getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.click(screen.getAllByRole('button', { name: '‹' })[1])
    expect(inputs()[1]).toHaveValue(4)
    fireEvent.click(screen.getAllByRole('button', { name: '›' })[1])
    expect(inputs()[1]).toHaveValue(5)
    fireEvent.change(inputs()[1], { target: { value: '99' } })
    expect(inputs()[1]).toHaveValue(20)
    expect(screen.getByText('30 / 15')).toBeInTheDocument()
    expect(screen.getByText(/exceeds required 15/)).toBeInTheDocument()
  })

  it('setting the take to zero removes the batch', () => {
    mount()
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '0' } })
    expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked()
  })

  it('warns about items with no batches and blocks confirming', () => {
    mount([item({ batches: [] })])
    expect(screen.getByText('No batches available for:')).toBeInTheDocument()
    expect(screen.getByText(/Paracetamol \/ 500mg — requires 15 units/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Batch Assignment' })).toBeDisabled()
  })

  it('already-assigned items are not shown and do not block', () => {
    const { onConfirm } = mount([item({ already_assigned: true })])
    expect(screen.queryByText('Required: 15 units')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Batch Assignment' }))
    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('Cancel and × both cancel', () => {
    const { onCancel } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('scanner toggle enables the hook', () => {
    mount()
    expect(scanner.enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Scan: off' }))
    expect(scanner.enabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Scan: on' })).toBeInTheDocument()
  })

  it('a scanned lot label selects the matching batch', async () => {
    mount()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    await act(async () => scanner.onScan('lot-b'))
    expect(screen.getAllByRole('checkbox')[1]).toBeChecked()
    expect(screen.getByText(/✓ .*lot LOT-B/)).toBeInTheDocument()
  })

  it('scanning an already selected lot says so', async () => {
    mount()
    await act(async () => scanner.onScan('LOT-A'))
    expect(screen.getByText('Batch LOT-A already selected')).toBeInTheDocument()
  })

  it('a scanned serial resolves to its batch through the API', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ json: async () => ({ kind: 'serial', serial: { batch_id: 'b3' } }) })
    vi.stubGlobal('fetch', f)
    mount()
    await act(async () => scanner.onScan('SN-123'))
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ code: 'SN-123' })
    await waitFor(() => expect(screen.getAllByRole('checkbox')[2]).toBeChecked())
  })

  it('an unknown code reports no matching batch', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ json: async () => ({ kind: 'none' }) }))
    mount()
    await act(async () => scanner.onScan('???'))
    expect(screen.getByText('No matching batch for "???"')).toBeInTheDocument()
  })

  it('a failing lookup reports no matching batch', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('x')))
    mount()
    await act(async () => scanner.onScan('???'))
    expect(screen.getByText('No matching batch for "???"')).toBeInTheDocument()
  })

  it('ignores blank scans', async () => {
    const f = vi.fn<(...a: any[]) => any>()
    vi.stubGlobal('fetch', f)
    mount()
    await act(async () => scanner.onScan('   '))
    expect(f).not.toHaveBeenCalled()
  })
})
