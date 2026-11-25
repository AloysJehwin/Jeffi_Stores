import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => canWrite }))
vi.mock('@/contexts/ToastContext', () => ({ useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/ui/CopySku', () => ({ default: ({ sku }: any) => <button aria-label={`copy ${sku}`} /> }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options }: any) => (
    <select aria-label="destination" value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
let typeaheadItem: any = null
vi.mock('@/components/admin/AdminTypeahead', () => ({
  default: ({ value, onChange, onSelect, placeholder }: any) => (
    <div>
      <input aria-label="product search" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      <button type="button" onClick={() => onSelect(typeaheadItem)}>pick product</button>
    </div>
  ),
}))

import { WarehouseForm, LocationForm, StockRow, AssignStockForm } from '@/components/admin/ShelvingParts'

const fetchMock = vi.fn<(...a: any[]) => any>()
const res = (ok: boolean, data: any = {}) => ({ ok, json: async () => data })

beforeEach(() => {
  canWrite = true
  vi.stubGlobal('fetch', fetchMock)
})

describe('WarehouseForm', () => {
  it('requires name and code', async () => {
    const onSave = vi.fn<(...a: any[]) => any>()
    render(<WarehouseForm onSave={onSave} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Name and code required')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('uppercases the code and saves trimmed values', async () => {
    const onSave = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    render(<WarehouseForm onSave={onSave} onCancel={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Main Store'), { target: { value: '  North  ' } })
    fireEvent.change(screen.getByPlaceholderText('WH1'), { target: { value: 'wh2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: 'North', code: 'WH2', address: '' }))
  })

  it('toasts the error when saving throws, and cancels', async () => {
    const onCancel = vi.fn<(...a: any[]) => any>()
    render(<WarehouseForm onSave={async () => { throw new Error('Duplicate code') }} onCancel={onCancel} initial={{ name: 'A', code: 'A1' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Duplicate code', 'error'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('LocationForm', () => {
  it('requires aisle, rack and shelf', async () => {
    const onSave = vi.fn<(...a: any[]) => any>()
    render(<LocationForm warehouseId="w1" onSave={onSave} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Aisle, rack and shelf required')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('uppercases aisle/shelf and saves with an optional bin', async () => {
    const onSave = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    render(<LocationForm warehouseId="w1" onSave={onSave} onCancel={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('A'), { target: { value: 'b' } })
    fireEvent.change(screen.getByPlaceholderText('01'), { target: { value: '07' } })
    fireEvent.change(screen.getByPlaceholderText('C'), { target: { value: 'd' } })
    fireEvent.change(screen.getByPlaceholderText('02'), { target: { value: '9' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Fragile items only'), { target: { value: 'top' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ aisle_code: 'B', rack_code: '07', shelf_code: 'D', bin_code: '9', notes: 'top' }))
  })

  it('shows locked levels as read-only text', () => {
    render(<LocationForm warehouseId="w1" onSave={async () => {}} onCancel={() => {}} initial={{ aisle_code: 'A', rack_code: '01' }} lockedLevels={['aisle', 'rack']} />)
    expect(screen.queryByPlaceholderText('A')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('01')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('C')).toBeInTheDocument()
  })
})

const row = (o: Record<string, any> = {}) => ({
  id: 'ss1', location_id: 'l1', product_id: 'p1', variant_id: null, sub_variant_id: null, quantity: 10, updated_at: '',
  product_name: 'Hammer', variant_name: 'Steel', sku: 'HAM-1', unit_label: 'pc', unit_factor: 1, unit_dimension: 'count', ...o,
})
const siblings = [
  { id: 'l1', display_code: 'A-01-C' },
  { id: 'l2', display_code: 'A-01-D' },
] as any

describe('StockRow', () => {
  it('shows product, variant, sku and the quantity with unit', () => {
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    expect(screen.getByText('Hammer')).toBeInTheDocument()
    expect(screen.getByText('Steel')).toBeInTheDocument()
    expect(screen.getByText('HAM-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /10\s*pc/ })).toBeInTheDocument()
  })

  it('adjusts the quantity by posting the base-unit difference', async () => {
    fetchMock.mockResolvedValue(res(true))
    const onRefresh = vi.fn<(...a: any[]) => any>()
    render(<StockRow row={row({ unit_factor: 2, quantity: 10 }) as any} locationId="l1" siblingLocations={siblings} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /5\s*pc/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(screen.getByLabelText('Save'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ location_id: 'l1', product_id: 'p1', quantity_change: 4, reason: 'adjustment' })
  })

  it('closes the editor without a request when the quantity is unchanged', () => {
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /10\s*pc/ }))
    fireEvent.click(screen.getByLabelText('Save'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('toasts an adjustment error', async () => {
    fetchMock.mockResolvedValue(res(false, { error: 'Not enough stock' }))
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /10\s*pc/ }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(screen.getByLabelText('Save'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Not enough stock', 'error'))
  })

  it('moves stock to another location, validating the destination first', async () => {
    fetchMock.mockResolvedValue(res(true))
    const onRefresh = vi.fn<(...a: any[]) => any>()
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(screen.getByRole('option', { name: 'A-01-D' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'A-01-C' })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    expect(await screen.findByText('Select destination')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('destination'), { target: { value: 'l2' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: 'move', from_location_id: 'l1', to_location_id: 'l2', quantity: 4 })
  })

  it('rejects an invalid move quantity', async () => {
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    fireEvent.change(screen.getByLabelText('destination'), { target: { value: 'l2' } })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    expect(await screen.findByText('Enter valid quantity')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is read-only without shelving write access', () => {
    canWrite = false
    render(<StockRow row={row() as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    expect(screen.getByRole('button', { name: /10\s*pc/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument()
  })

  it('expands perishable batches with FIFO tag, and moves chosen batches', async () => {
    fetchMock.mockResolvedValue(res(true))
    const batches = [
      { id: 'b1', lot_number: 'LOT-1', manufacture_date: '2026-01-01', expiry_date: '2020-01-01', quantity_remaining: 6 },
      { id: 'b2', lot_number: 'LOT-2', manufacture_date: null, expiry_date: null, quantity_remaining: 4 },
    ]
    const onRefresh = vi.fn<(...a: any[]) => any>()
    render(<StockRow row={row({ perishable: true, batches }) as any} locationId="l1" siblingLocations={siblings} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /10\s*pc/ }))
    expect(screen.getByText('LOT-1')).toBeInTheDocument()
    expect(screen.getByText('FIFO')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    // all batches are pre-selected, total shown
    expect(screen.getByText(/Total to move/)).toHaveTextContent('10 pc')
    fireEvent.change(screen.getByLabelText('destination'), { target: { value: 'l2' } })
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1])
    expect(screen.getByText(/Total to move/)).toHaveTextContent('6 pc')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move' })[1])
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).quantity).toBe(6)
  })

  it('lists serial numbers for serialized stock', () => {
    const batches = [{ id: 'b1', lot_number: null, manufacture_date: null, expiry_date: null, quantity_remaining: 2, serials: ['SN-1', 'SN-2'] }]
    render(<StockRow row={row({ serialized: true, quantity: 2, batches }) as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /2\s*pc/ }))
    expect(screen.getByText('SN-1')).toBeInTheDocument()
    expect(screen.getByText('SN-2')).toBeInTheDocument()
  })

  it('shows continuous quantities with three decimals', () => {
    render(<StockRow row={row({ unit_dimension: 'weight', unit_label: 'kg', unit_factor: 1000, quantity: 2500 }) as any} locationId="l1" siblingLocations={siblings} onRefresh={() => {}} />)
    expect(screen.getByRole('button', { name: /2\.500\s*kg/ })).toBeInTheDocument()
  })
})

const location = { id: 'l1', display_code: 'A-01-C' } as any
const itemId = (o: { inv?: number; productId?: string } = {}) => {
  const parts = Array(15).fill('')
  parts[0] = 'product:p1'
  parts[11] = String(o.inv ?? 10)
  parts[12] = 'p1'
  return parts.join('\x1f')
}

describe('AssignStockForm', () => {
  it('requires picking a product first', async () => {
    render(<AssignStockForm location={location} onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('A-01-C')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('shows inventory, shelf allocation and availability after selecting a product', async () => {
    typeaheadItem = { id: itemId(), label: 'Hammer (HAM-1)' }
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/shelving/stock')
      ? res(true, { locations: [{ quantity: 4 }] })
      : res(true, { units: [{ id: 'u1', unit: 'pc', display_label: null, factor: 1, dimension: 'count', is_base: true }] })))
    render(<AssignStockForm location={location} onSave={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('pick product'))
    expect(await screen.findByText('6 available')).toBeInTheDocument()
    expect(screen.getByText('Total inventory')).toBeInTheDocument()
    expect(screen.getByText(/On shelves/)).toHaveTextContent('4 pc')
    expect(screen.getByRole('button', { name: 'All (6)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All (6)' }))
    expect(screen.getByRole('spinbutton')).toHaveValue(6)
  })

  it('assigns the quantity and calls onSave', async () => {
    typeaheadItem = { id: itemId(), label: 'Hammer' }
    const onSave = vi.fn<(...a: any[]) => any>()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return res(true)
      return String(url).includes('/shelving/stock') ? res(true, { locations: [] }) : res(true, { units: [] })
    })
    render(<AssignStockForm location={location} onSave={onSave} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('pick product'))
    await screen.findByText('10 available')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ location_id: 'l1', product_id: 'p1', quantity_change: 3, reason: 'assign' })
  })

  it('rejects more than the unallocated quantity', async () => {
    typeaheadItem = { id: itemId({ inv: 5 }), label: 'Hammer' }
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/shelving/stock') ? res(true, { locations: [] }) : res(true, { units: [] })))
    render(<AssignStockForm location={location} onSave={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('pick product'))
    await screen.findByText('5 available')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Assign' }).closest('form')!)
    expect(await screen.findByText('Only 5 unit(s) unallocated')).toBeInTheDocument()
  })

  it('disables Assign when everything is already on shelves', async () => {
    typeaheadItem = { id: itemId({ inv: 4 }), label: 'Hammer' }
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/shelving/stock') ? res(true, { locations: [{ quantity: 4 }] }) : res(true, { units: [] })))
    render(<AssignStockForm location={location} onSave={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('pick product'))
    expect(await screen.findByText('All allocated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('clears the selection when the search is emptied, and cancels', async () => {
    typeaheadItem = { id: itemId(), label: 'Hammer' }
    const onCancel = vi.fn<(...a: any[]) => any>()
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/shelving/stock') ? res(true, { locations: [] }) : res(true, { units: [] })))
    render(<AssignStockForm location={location} onSave={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('pick product'))
    await screen.findByText('10 available')
    fireEvent.change(screen.getByLabelText('product search'), { target: { value: '' } })
    expect(screen.queryByText('Total inventory')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
