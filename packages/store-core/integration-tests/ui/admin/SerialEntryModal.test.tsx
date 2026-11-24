import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import SerialEntryModal, { SerialPicker } from '@/components/admin/SerialEntryModal'

// Serial assignment for order lines: scan mode (one field per unit, validated against in-stock serials)
// and a click mode (grouped checkboxes). Confirm stays disabled until every line has exactly its count.

const serials = [
  { serial_number: 'SN-001', batch_id: 'b1', lot_number: 'LOT-A' },
  { serial_number: 'SN-002', batch_id: 'b1', lot_number: 'LOT-A' },
  { serial_number: 'SN-003', batch_id: null, lot_number: null },
]
const line = (o: Record<string, any> = {}) => ({
  order_item_id: 'oi1', product_name: 'Drill', variant_name: '18V', required_qty: 2, already_assigned: false, product_id: 'p1', ...o,
})
const fetchMock = vi.fn<(...a: any[]) => any>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ json: async () => ({ serials }) })
})

const scanFields = () => screen.getAllByPlaceholderText(/Scan serial/) as HTMLInputElement[]
const scan = (el: HTMLInputElement, v: string) => {
  fireEvent.change(el, { target: { value: v } })
  fireEvent.keyDown(el, { key: 'Enter' })
}

describe('SerialEntryModal', () => {
  it('loads available serials for the product/variant and shows a scan field per unit', async () => {
    render(<SerialEntryModal items={[line({ variant_id: 'v1', sub_variant_id: 's1' })]} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('Select Serial Numbers')).toBeInTheDocument()
    expect(screen.getByText('Drill / 18V')).toBeInTheDocument()
    await waitFor(() => expect(scanFields()).toHaveLength(2))
    expect(fetchMock.mock.calls[0][0]).toContain('product_id=p1')
    expect(fetchMock.mock.calls[0][0]).toContain('variant_id=v1')
    expect(fetchMock.mock.calls[0][0]).toContain('sub_variant_id=s1')
    expect(screen.getByText(/3 available/)).toBeInTheDocument()
    // the first in-stock serials are pre-selected into the scan fields
    await waitFor(() => expect(scanFields()[0]).toHaveValue('SN-001'))
    expect(scanFields()[1]).toHaveValue('SN-002')
  })

  it('validates scanned serials and confirms the assignments', async () => {
    const onConfirm = vi.fn<(...a: any[]) => any>()
    render(<SerialEntryModal items={[line()]} onConfirm={onConfirm} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()[1]).toHaveValue('SN-002'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Serials' })).toBeEnabled())
    scan(scanFields()[1], 'BOGUS')
    expect(screen.getByText(/Some serials are not in stock/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Serials' })).toBeDisabled()
    scan(scanFields()[1], 'sn-003')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Serials' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Serials' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { order_item_id: 'oi1', serial_number: 'SN-001' },
      { order_item_id: 'oi1', serial_number: 'SN-003' },
    ])
  })

  it('does not count a duplicate entry twice', async () => {
    render(<SerialEntryModal items={[line()]} onConfirm={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()).toHaveLength(2))
    await waitFor(() => expect(scanFields()[1]).toHaveValue('SN-002'))
    scan(scanFields()[1], 'SN-001')
    expect(screen.getByText(/Duplicate serials entered/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Serials' })).toBeDisabled()
  })

  it('switches to click mode and picks serials grouped by lot', async () => {
    const onConfirm = vi.fn<(...a: any[]) => any>()
    render(<SerialEntryModal items={[line()]} onConfirm={onConfirm} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /Scan: on/ }))
    expect(await screen.findByText('LOT-A')).toBeInTheDocument()
    expect(screen.getByText('No Lot')).toBeInTheDocument()
    expect(screen.getByText(/3 serials in stock across 2 batches — select exactly 2/)).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    await waitFor(() => expect(screen.getByText('2 / 2 selected')).toBeInTheDocument())
    // at the cap, unchecked boxes are disabled
    expect(boxes.filter(b => !b.checked).every(b => b.disabled)).toBe(true)
    fireEvent.click(boxes.find(b => b.checked)!)
    expect(screen.getByText('1 / 2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Serials' })).toBeDisabled()
  })

  it('collapses a lot group', async () => {
    render(<SerialEntryModal items={[line()]} onConfirm={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /Scan: on/ }))
    await screen.findByText('LOT-A')
    expect(screen.getByText('SN-001')).toBeInTheDocument()
    fireEvent.click(screen.getByText('LOT-A'))
    expect(screen.queryByText('SN-001')).not.toBeInTheDocument()
  })

  it('skips already-assigned lines and enables Confirm straight away when nothing needs entry', () => {
    const onConfirm = vi.fn<(...a: any[]) => any>()
    render(<SerialEntryModal items={[line({ already_assigned: true })]} onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.queryByText('Drill / 18V')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Serials' }))
    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('uses required_serials rather than base units when qty_step differs', async () => {
    render(<SerialEntryModal items={[line({ required_qty: 6, required_serials: 3, qty_step: 2 })]} onConfirm={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()).toHaveLength(3))
  })

  it('pre-fills pre-assigned serials even when they are no longer in stock', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ serials: [serials[0]] }) })
    render(<SerialEntryModal items={[line({ required_qty: 1, preassigned: ['RESERVED-9'] })]} onConfirm={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(scanFields()[0]).toHaveValue('RESERVED-9'))
    expect(screen.getByText('1 / 1 selected')).toBeInTheDocument()
  })

  it('cancels from the X and Cancel buttons', () => {
    const onCancel = vi.fn<(...a: any[]) => any>()
    render(<SerialEntryModal items={[line()]} onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})

describe('SerialPicker', () => {
  it('warns when the product has no in-stock serials', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ serials: [] }) })
    render(<SerialPicker item={line() as any} selected={new Set()} onChange={() => {}} />)
    expect(await screen.findByText('No in-stock serials found for this product')).toBeInTheDocument()
  })

  it('does not fetch without a product id', () => {
    render(<SerialPicker item={line({ product_id: undefined }) as any} selected={new Set()} onChange={() => {}} scanEnabled={false} autoFill={false} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('without autoFill the inline picker leaves the selection alone until the user ticks', async () => {
    const onChange = vi.fn<(...a: any[]) => any>()
    render(<SerialPicker item={line({ required_qty: 1 }) as any} selected={new Set()} onChange={onChange} scanEnabled={false} autoFill={false} />)
    await screen.findByText('SN-001')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onChange.mock.calls[0][0]).toEqual(new Set(['SN-001']))
  })

  it('filters a long serial list by search', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ serial_number: `X-${i}`, batch_id: null, lot_number: null }))
    fetchMock.mockResolvedValue({ json: async () => ({ serials: many }) })
    render(<SerialPicker item={line({ required_qty: 1 }) as any} selected={new Set()} onChange={() => {}} scanEnabled={false} autoFill={false} />)
    const box = await screen.findByPlaceholderText('Filter serials or lot…')
    fireEvent.change(box, { target: { value: 'x-7' } })
    expect(screen.getByText('X-7')).toBeInTheDocument()
    expect(screen.queryByText('X-3')).not.toBeInTheDocument()
  })
})
