import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const push = vi.fn()
const replace = vi.fn()
let sp = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/admin/shelving',
  useSearchParams: () => sp,
}))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
const confirm = vi.fn()
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => confirm }))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, options, onChange, placeholder }: any) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@/components/admin/ShelvingParts', () => ({
  WarehouseForm: ({ onSave, onCancel, initial }: any) => (
    <div>
      <p>warehouse-form:{initial?.name ?? 'new'}</p>
      <button onClick={() => onSave({ name: 'North', code: 'NR', address: 'x' }).catch((e: Error) => showToast(e.message, 'error'))}>save-warehouse</button>
      <button onClick={onCancel}>cancel-warehouse</button>
    </div>
  ),
  LocationForm: ({ onSave, onCancel, initial, lockedLevels, warehouseId }: any) => (
    <div>
      <p>location-form:{initial?.display_code ?? initial?.aisle_code ?? 'new'}:{initial?.rack_code ?? ''}:{(lockedLevels ?? []).join(',')}:{warehouseId}</p>
      <button onClick={() => onSave({ aisle_code: 'B', rack_code: '1', shelf_code: '2', bin_code: '', notes: '' })}>save-location</button>
      <button onClick={onCancel}>cancel-location</button>
    </div>
  ),
  StockRow: ({ row, onRefresh }: any) => (
    <div>
      <span>stock:{row.product_name}:{row.quantity}</span>
      <button onClick={onRefresh}>refresh-{row.id}</button>
    </div>
  ),
  AssignStockForm: ({ location, onSave, onCancel }: any) => (
    <div>
      <p>assign-form:{location.display_code}</p>
      <button onClick={onSave}>assign-save</button>
      <button onClick={onCancel}>assign-cancel</button>
    </div>
  ),
}))

import ShelvingClient from '@admin/app/(admin)/admin/shelving/ShelvingClient'

const wh = (over: any = {}) => ({ id: 'w1', name: 'Main', code: 'MN', address: null, is_active: true, ...over })
const loc = (over: any = {}) => ({
  id: 'l1', warehouse_id: 'w1', warehouse_name: 'Main', warehouse_code: 'MN', aisle_code: 'A', rack_code: '1', shelf_code: '1', bin_code: null,
  display_code: 'MN-A-1-1', notes: 'Top shelf', is_active: true, is_open_shelf: false, stock_count: 2, ...over,
})
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body, blob: async () => new Blob(['pdf']) })
const fetchMock = vi.fn()
let warehouses: any[]
let locations: any[]
let stock: any[]
const calls = (m: string) => fetchMock.mock.calls.filter(c => c[1]?.method === m)

describe('ShelvingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sp = new URLSearchParams()
    confirm.mockResolvedValue(true)
    warehouses = [wh(), wh({ id: 'w2', name: 'Annex', code: 'AX', is_active: false })]
    locations = [
      loc(),
      loc({ id: 'l2', rack_code: '2', display_code: 'MN-A-2-1', stock_count: 0 }),
      loc({ id: 'l3', aisle_code: 'B', display_code: 'MN-B-1-1', notes: null, is_active: false }),
      loc({ id: 'l4', aisle_code: 'OPEN', rack_code: '', shelf_code: '', display_code: 'OPEN-SHELF', is_open_shelf: true, notes: null, stock_count: 0 }),
    ]
    stock = [{ id: 's1', product_name: 'Drill', quantity: 4 }, { id: 's2', product_name: 'Saw', quantity: 1 }]
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/shelving/warehouses' && !init?.method) return json(true, { warehouses })
      if (url.startsWith('/api/admin/shelving/locations?')) return json(true, { locations })
      if (url.startsWith('/api/admin/shelving/stock?')) return json(true, { stock })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  it('lists warehouses, flags inactive ones, and asks to pick a warehouse first', async () => {
    render(asAdmin(<ShelvingClient />))
    expect(await screen.findByText('Main')).toBeInTheDocument()
    expect(screen.getByText('Annex')).toBeInTheDocument()
    expect(screen.getByText('off')).toBeInTheDocument()
    expect(screen.getByText('Select a warehouse first')).toBeInTheDocument()
    expect(screen.getByText('No location selected')).toBeInTheDocument()
  })

  it('shows the empty warehouse hint and a load error', async () => {
    warehouses = []
    const { unmount } = render(asAdmin(<ShelvingClient />))
    expect(await screen.findByText('No warehouses yet')).toBeInTheDocument()
    unmount()
    fetchMock.mockImplementation(async () => json(false, {}, 500))
    render(asAdmin(<ShelvingClient />))
    expect(await screen.findByText('Failed to load warehouses')).toBeInTheDocument()
  })

  it('picking a warehouse loads its locations and updates the URL', async () => {
    render(asAdmin(<ShelvingClient />))
    fireEvent.click(await screen.findByText('Main'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/shelving/locations?warehouse_id=w1'))
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('wh=w1'), { scroll: false })
    expect(await screen.findByText('OPEN-SHELF')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OPEN' })).not.toBeInTheDocument()
  })

  it('drills aisle to rack to shelf and shows the location with its stock', async () => {
    render(asAdmin(<ShelvingClient />))
    fireEvent.click(await screen.findByText('Main'))
    fireEvent.click(await screen.findByRole('button', { name: 'A' }))
    fireEvent.click(await screen.findByRole('button', { name: '1' }))
    fireEvent.click(await screen.findByRole('button', { name: /MN-A-1-1/ }))
    expect(await screen.findByText('stock:Drill:4')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/shelving/stock?location_id=l1', { credentials: 'include' })
    expect(screen.getByText('Stock — 2 SKUs')).toBeInTheDocument()
    expect(screen.getByText('Top shelf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'refresh-s1' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/shelving/stock?')).length).toBe(2))
  })

  it('restores warehouse, aisle, rack and location from the URL', async () => {
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    expect(await screen.findByText('stock:Drill:4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MN-A-1-1 2' })).toBeInTheDocument()
  })

  it('shows the empty-stock state and an inactive badge', async () => {
    stock = []
    locations = [loc({ is_active: false })]
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    expect(await screen.findByText('No stock assigned here yet')).toBeInTheDocument()
    expect(screen.getByText('inactive')).toBeInTheDocument()
  })

  it('Assign Stock opens the form for the location and refreshes stock after saving', async () => {
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('stock:Drill:4')
    fireEvent.click(screen.getByRole('button', { name: '+ Assign Stock' }))
    expect(screen.getByText('assign-form:MN-A-1-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'assign-save' }))
    await waitFor(() => expect(screen.queryByText('assign-form:MN-A-1-1')).not.toBeInTheDocument())
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/admin/shelving/stock?')).length).toBe(2))
  })

  it('Add warehouse opens the form; saving POSTs it and reloads the list', async () => {
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('Main')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    expect(screen.getByText('New Warehouse')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save-warehouse' }))
    await waitFor(() => expect(calls('POST').length).toBe(1))
    expect(calls('POST')[0][0]).toBe('/api/admin/shelving/warehouses')
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ name: 'North', code: 'NR', address: 'x' })
    await waitFor(() => expect(screen.queryByText('New Warehouse')).not.toBeInTheDocument())
  })

  it('a rejected warehouse save surfaces the API error', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(false, { error: 'Code already used' }, 409)
      return json(true, { warehouses })
    })
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('Main')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'save-warehouse' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Code already used', 'error'))
    expect(screen.getByText('New Warehouse')).toBeInTheDocument()
  })

  it('editing a warehouse PATCHes it', async () => {
    render(asAdmin(<ShelvingClient />))
    const chip = (await screen.findByText('Main')).closest('.group') as HTMLElement
    fireEvent.click(within(chip).getAllByRole('button')[1])
    expect(screen.getByText('Edit Warehouse')).toBeInTheDocument()
    expect(screen.getByText('warehouse-form:Main')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save-warehouse' }))
    await waitFor(() => expect(calls('PATCH').length).toBe(1))
    expect(calls('PATCH')[0][0]).toBe('/api/admin/shelving/warehouses/w1')
  })

  it('deleting a warehouse confirms first, then DELETEs and reloads', async () => {
    render(asAdmin(<ShelvingClient />))
    const chip = (await screen.findByText('Main')).closest('.group') as HTMLElement
    fireEvent.click(within(chip).getAllByRole('button')[2])
    await waitFor(() => expect(calls('DELETE').length).toBe(1))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete warehouse?', variant: 'danger' }))
    expect(calls('DELETE')[0][0]).toBe('/api/admin/shelving/warehouses/w1')
  })

  it('does not delete when the confirmation is declined, and toasts a failed delete', async () => {
    confirm.mockResolvedValueOnce(false)
    render(asAdmin(<ShelvingClient />))
    const chip = (await screen.findByText('Main')).closest('.group') as HTMLElement
    fireEvent.click(within(chip).getAllByRole('button')[2])
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(calls('DELETE').length).toBe(0)
    fetchMock.mockImplementation(async (url: string, init?: any) =>
      init?.method === 'DELETE' ? json(false, { error: 'Has stock' }, 400) : json(true, { warehouses }))
    fireEvent.click(within(chip).getAllByRole('button')[2])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Has stock', 'error'))
  })

  it('adding a location under a rack prefills and locks aisle and rack, and POSTs with the warehouse', async () => {
    render(asAdmin(<ShelvingClient />))
    fireEvent.click(await screen.findByText('Main'))
    fireEvent.click(await screen.findByRole('button', { name: 'A' }))
    fireEvent.click(await screen.findByRole('button', { name: '1' }))
    const adds = screen.getAllByRole('button', { name: 'Add' })
    fireEvent.click(adds[adds.length - 1])
    expect(screen.getByText('New Location')).toBeInTheDocument()
    expect(screen.getByText('location-form:A:1:aisle,rack:w1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save-location' }))
    await waitFor(() => expect(calls('POST').length).toBe(1))
    expect(calls('POST')[0][0]).toBe('/api/admin/shelving/locations')
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ warehouse_id: 'w1', aisle_code: 'B', rack_code: '1', shelf_code: '2', bin_code: '', notes: '' })
  })

  it('edit and delete a selected location from the header actions', async () => {
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('stock:Drill:4')
    fireEvent.click(screen.getByTitle('Edit location'))
    expect(screen.getByText('Edit Location')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save-location' }))
    await waitFor(() => expect(calls('PATCH').length).toBe(1))
    expect(calls('PATCH')[0][0]).toBe('/api/admin/shelving/locations/l1')
    fireEvent.click(screen.getByTitle('Delete location'))
    await waitFor(() => expect(calls('DELETE').length).toBe(1))
    expect(calls('DELETE')[0][0]).toBe('/api/admin/shelving/locations/l1')
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete location?' }))
  })

  it('Print Label downloads a PDF for the location, and for the open shelf sends a synthetic item', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('stock:Drill:4')
    fireEvent.click(screen.getByRole('button', { name: 'Print Label' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ location_ids: ['l1'], copies: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'OPEN-SHELF' }))
    await waitFor(() => expect(screen.getByText('stock:Drill:4')).toBeInTheDocument())
    fireEvent.click(await screen.findByRole('button', { name: 'Print Label' }))
    await waitFor(() => expect(calls('POST').length).toBe(2))
    expect(JSON.parse(calls('POST')[1][1].body)).toEqual({ items: [{ displayCode: 'OPEN-SHELF', warehouseName: 'Main' }], copies: 1 })
    click.mockRestore()
  })

  it('toasts when label generation fails', async () => {
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asAdmin(<ShelvingClient />))
    await screen.findByText('stock:Drill:4')
    fetchMock.mockImplementation(async () => json(false, { error: 'PDF engine down' }, 500))
    fireEvent.click(screen.getByRole('button', { name: 'Print Label' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('PDF engine down', 'error'))
  })

  it('hides the write controls without shelving write access', async () => {
    sp = new URLSearchParams('wh=w1&loc=l1')
    render(asMember(<ShelvingClient />, ['shelving:read']))
    await screen.findByText('stock:Drill:4')
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Assign Stock' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Edit location')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print Label' })).toBeInTheDocument()
  })

  describe('Labels tab', () => {
    async function openLabels() {
      sp = new URLSearchParams('tab=labels&wh=w1')
      render(asAdmin(<ShelvingClient />))
      await screen.findByText('MN-A-1-1')
    }

    it('lists the warehouse locations and filters by aisle, rack and shelf', async () => {
      await openLabels()
      expect(screen.getByText('MN-B-1-1')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('All aisles'), { target: { value: 'B' } })
      expect(screen.queryByText('MN-A-1-1')).not.toBeInTheDocument()
      expect(screen.getByText('MN-B-1-1')).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('All aisles'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('All racks'), { target: { value: '2' } })
      expect(screen.getByText('MN-A-2-1')).toBeInTheDocument()
      expect(screen.queryByText('MN-A-1-1')).not.toBeInTheDocument()
    })

    it('selecting locations shows cards, All/None work on the visible set', async () => {
      await openLabels()
      expect(screen.getByText('No labels selected')).toBeInTheDocument()
      fireEvent.click(screen.getAllByRole('checkbox')[0])
      expect(screen.getByText('1 label')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'All' }))
      expect(screen.getByText('4 labels')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'None' }))
      expect(screen.getByText('No labels selected')).toBeInTheDocument()
    })

    it('downloads selected labels with the copies each, and all labels at once', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      await openLabels()
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
      fireEvent.click(screen.getAllByRole('checkbox')[0])
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
      fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
      await waitFor(() => expect(click).toHaveBeenCalled())
      expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ location_ids: ['l1'], copies: 3 })
      fireEvent.click(screen.getByRole('button', { name: 'All (4)' }))
      await waitFor(() => expect(calls('POST').length).toBe(2))
      expect(JSON.parse(calls('POST')[1][1].body)).toEqual({ location_ids: ['l1', 'l2', 'l3', 'l4'], copies: 3 })
      click.mockRestore()
    })

    it('switching tab pushes it to the URL', async () => {
      render(asAdmin(<ShelvingClient />))
      await screen.findByText('Main')
      fireEvent.click(screen.getByRole('tab', { name: 'Labels' }))
      expect(push).toHaveBeenCalledWith(expect.stringContaining('tab=labels'), { scroll: false })
      expect(screen.getByText('Filter Locations')).toBeInTheDocument()
    })
  })
})
