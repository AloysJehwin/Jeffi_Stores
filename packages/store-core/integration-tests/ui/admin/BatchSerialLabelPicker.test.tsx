import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
let scanner: { onScan: (c: string) => void; enabled: boolean }
vi.mock('@/hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: (o: any) => {
    scanner = o
  },
}))
vi.mock('@/components/admin/label-preview', () => ({
  BatchSerialPreview: ({ mode, batch, serial, size }: any) => (
    <div data-testid="preview">
      {mode}|{size.size}|{batch ? `${batch.productName}/${batch.lotNumber}/${batch.expiryDate}/${batch.quantity}` : ''}|
      {serial ? `${serial.productName}/${serial.serialNumber}/${serial.lotNumber}` : ''}
    </div>
  ),
}))
vi.mock('@/components/admin/AdminTypeahead', () => ({
  default: ({ type, value, onChange, onSelect, placeholder }: any) => (
    <div>
      <input aria-label={`ta:${type}`} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
      <button onClick={() => onSelect({ id: ['x', 'Widget', '', 'LOT-9'].join('\x1f') })}>ta-pick-batch</button>
      <button
        onClick={() => {
          const parts = Array(15).fill('')
          parts[0] = 'variant:v7'
          parts[1] = 'Phone'
          parts[2] = '128GB'
          parts[3] = 'PH-1'
          parts[12] = 'p7'
          onSelect({ id: parts.join('\x1f') })
        }}
      >
        ta-pick-serial
      </button>
    </div>
  ),
}))
vi.mock('@/components/ui/CopySku', () => ({ default: () => <i /> }))

import BatchSerialLabelPicker from '@/components/admin/BatchSerialLabelPicker'

const batches = [
  { id: 'b1', lot_number: 'LOT-1', expiry_date: '2027-03-04T00:00:00Z', manufacture_date: null, quantity_remaining: 24, product_name: 'Syrup', sku: 'SY-1', variant_name: '100ml' },
  { id: 'b2', lot_number: null, expiry_date: null, manufacture_date: null, quantity_remaining: 0, product_name: 'Tablet', sku: 'TB-1', variant_name: null },
]
const serialProducts = [{ product_id: 'p1', variant_id: null, product_name: 'Laptop', sku: 'LP-1', variant_name: null, in_stock_count: 3 }]
const serials = [
  { serial_number: 'SN-1', batch_id: null, lot_number: 'L1' },
  { serial_number: 'SN-2', batch_id: null, lot_number: null },
]

const J = (body: unknown, ok = true) => ({ ok, json: async () => body, blob: async () => new Blob(['pdf']) })

function route(map: Record<string, any>) {
  const f = vi.fn<(...a: any[]) => any>().mockImplementation(async (url: string, init?: any) => {
    for (const [k, v] of Object.entries(map)) if (url.includes(k)) return typeof v === 'function' ? v(url, init) : v
    return J({})
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('BatchSerialLabelPicker batch mode', () => {
  beforeEach(() => {
    scanner = { onScan: () => {}, enabled: false }
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  })

  it('lists batches from the search endpoint with lot, expiry and quantity', async () => {
    const f = route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    expect(await screen.findByText('Syrup — 100ml')).toBeInTheDocument()
    expect(screen.getByText(/LOT LOT-1 · EXP 2027-03-04 · Qty 24/)).toBeInTheDocument()
    expect(screen.getByText(/LOT — · EXP — · Qty 0/)).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/admin/labels/batch/list?q=')
  })

  it('shows the empty state', async () => {
    route({ '/labels/batch/list': J({ batches: [] }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    expect(await screen.findByText('No batches found.')).toBeInTheDocument()
  })

  it('treats a failed list request as empty', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('x')))
    render(<BatchSerialLabelPicker mode="batch" />)
    expect(await screen.findByText('No batches found.')).toBeInTheDocument()
  })

  it('search typeahead picks refine the query', async () => {
    const f = route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    await screen.findByText('Syrup — 100ml')
    fireEvent.click(screen.getByText('ta-pick-batch'))
    await waitFor(() => expect(f.mock.calls.some(c => String(c[0]).includes('q=LOT-9'))).toBe(true))
  })

  it('selecting a batch defaults its count to the quantity and updates the total and download label', async () => {
    route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    fireEvent.click(await screen.findByText('Syrup — 100ml'))
    expect(screen.getByRole('button', { name: 'Download PDF — 24 labels' })).toBeEnabled()
    expect(screen.getByText('24', { selector: '.font-semibold' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByRole('button', { name: 'Download PDF — 23 labels' })).toBeInTheDocument()
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '5' } })
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '2' } })
    expect(screen.getByRole('button', { name: 'Download PDF — 10 labels' })).toBeInTheDocument()
  })

  it('a zero-stock batch still gets at least one label', async () => {
    route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    fireEvent.click(await screen.findByText('Tablet'))
    expect(screen.getByRole('button', { name: 'Download PDF — 1 label' })).toBeInTheDocument()
  })

  it('download is disabled until something is selected', async () => {
    route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    await screen.findByText('Syrup — 100ml')
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled()
  })

  it('posts the chosen options and saves a PDF', async () => {
    const f = route({ '/labels/batch/list': J({ batches }), '/api/admin/labels/batch': J({}) })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BatchSerialLabelPicker mode="batch" />)
    fireEvent.click(await screen.findByText('Syrup — 100ml'))
    fireEvent.click(screen.getByRole('button', { name: '50×50 mm' }))
    fireEvent.click(screen.getByRole('button', { name: 'A4 sheet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Print Price: Off' }))
    fireEvent.click(screen.getByRole('button', { name: 'QR Action: Off' }))
    fireEvent.change(screen.getByLabelText('Copies'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('/api/admin/labels/batch')
    expect(JSON.parse(post[1].body)).toEqual({
      copies: 2, sheet: true, size: '50x50', showPrice: true, qrAction: true, batches: [{ id: 'b1', count: 24 }],
    })
  })

  it('toasts the server error when generation fails', async () => {
    route({ '/labels/batch/list': J({ batches }), '/api/admin/labels/batch': J({ error: 'No template' }, false) })
    render(<BatchSerialLabelPicker mode="batch" />)
    fireEvent.click(await screen.findByText('Syrup — 100ml'))
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No template', 'error'))
  })

  it('previews the first listed batch in the active size and hides the shelf card size', async () => {
    route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" />)
    await screen.findByText('Syrup — 100ml')
    expect(screen.getByTestId('preview')).toHaveTextContent('batch|40x60|Syrup/LOT-1/2027-03-04/24')
    expect(screen.queryByRole('button', { name: /Shelf Card/ })).toBeNull()
  })

  it('preselected batches start selected', async () => {
    route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" preselectedBatchIds={['b1']} />)
    await screen.findByText('Syrup — 100ml')
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeEnabled()
  })

  it('a locked product loads its batches and hides the search box', async () => {
    const lock = { product_id: 'p9' }
    const f = route({ '/labels/batch/list': J({ batches }) })
    render(<BatchSerialLabelPicker mode="batch" lockProduct={lock} />)
    await screen.findByText('Syrup — 100ml')
    expect(f.mock.calls[0][0]).toBe('/api/admin/labels/batch/list?product_id=p9')
    expect(screen.queryByLabelText('ta:batch_products')).toBeNull()
  })

  it('honours a restricted label size list', async () => {
    route({ '/labels/batch/list': J({ batches: [] }) })
    render(
      <BatchSerialLabelPicker
        mode="batch"
        labelSizes={[{ size: '40x60', widthMm: 60, heightMm: 40, widthPt: 170, heightPt: 113, label: 'Only size' } as any]}
      />
    )
    expect(await screen.findByRole('button', { name: 'Only size' })).toBeInTheDocument()
  })
})

describe('BatchSerialLabelPicker serial mode', () => {
  beforeEach(() => {
    scanner = { onScan: () => {}, enabled: false }
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  })

  const defaultRoutes = () => ({
    '/labels/serial/products': J({ products: serialProducts }),
    '/inventory/serials/available': J({ serials }),
  })

  it('lists serialized products with stock counts and enables the scanner', async () => {
    route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" />)
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    expect(screen.getByText('3 in stock')).toBeInTheDocument()
    expect(scanner.enabled).toBe(true)
  })

  it('shows the empty product state', async () => {
    route({ '/labels/serial/products': J({ products: [] }) })
    render(<BatchSerialLabelPicker mode="serial" />)
    expect(await screen.findByText('No serialized products with in-stock serials.')).toBeInTheDocument()
  })

  it('choosing a product loads its serials; select all, toggle, clear, and change product', async () => {
    const f = route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" />)
    fireEvent.click(await screen.findByText('Laptop'))
    expect(await screen.findByText('SN-1')).toBeInTheDocument()
    expect(f.mock.calls.at(-1)![0]).toBe('/api/admin/inventory/serials/available?product_id=p1')
    expect(screen.getByText('LOT L1')).toBeInTheDocument()
    expect(screen.getByText('Laptop', { selector: 'span' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }))
    expect(screen.getByRole('button', { name: 'Download PDF — 2 labels' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('SN-1'))
    expect(screen.getByRole('button', { name: 'Download PDF — 1 label' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Change product' }))
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
  })

  it('previews the first serial with the resolved product name', async () => {
    route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" />)
    fireEvent.click(await screen.findByText('Laptop'))
    await screen.findByText('SN-1')
    expect(screen.getByTestId('preview')).toHaveTextContent('serial|40x60||Laptop/SN-1/L1')
  })

  it('the serial typeahead resolves variant and product ids from the encoded suggestion', async () => {
    const f = route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" />)
    await screen.findByText('Laptop')
    fireEvent.click(screen.getByText('ta-pick-serial'))
    await screen.findByText('SN-1')
    expect(f.mock.calls.at(-1)![0]).toBe('/api/admin/inventory/serials/available?product_id=p7&variant_id=v7')
    expect(screen.getByText('Phone — 128GB')).toBeInTheDocument()
  })

  it('a locked product loads its serials without the picker', async () => {
    const lock = { product_id: 'p3', variant_id: 'v3', name: 'Camera' }
    const f = route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" lockProduct={lock} />)
    expect(await screen.findByText('SN-1')).toBeInTheDocument()
    expect(f.mock.calls[0][0]).toBe('/api/admin/inventory/serials/available?product_id=p3&variant_id=v3')
    expect(screen.getByText('Camera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change product' })).toBeNull()
    expect(scanner.enabled).toBe(false)
  })

  it('preselected serials start selected', async () => {
    route(defaultRoutes())
    render(<BatchSerialLabelPicker mode="serial" preselectedSerials={['SN-9']} />)
    await screen.findByText('Laptop')
    expect(screen.getByRole('button', { name: 'Download PDF — 1 label' })).toBeEnabled()
  })

  it('posts serial numbers on download', async () => {
    const f = route({ ...defaultRoutes(), '/api/admin/labels/batch': J({}) })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BatchSerialLabelPicker mode="serial" />)
    fireEvent.click(await screen.findByText('Laptop'))
    fireEvent.click(await screen.findByRole('button', { name: 'Select all (2)' }))
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }))
    await waitFor(() => expect(f.mock.calls.some(c => c[1]?.method === 'POST')).toBe(true))
    const post = f.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body).serial_numbers).toEqual(['SN-1', 'SN-2'])
  })

  describe('hardware scan', () => {
    it('a scanned serial is added and its product resolved', async () => {
      route({
        ...defaultRoutes(),
        '/scan/resolve': J({ kind: 'serial', serial: { serial_number: 'SN-7', product_id: 'p1', product_name: 'Laptop' } }),
      })
      render(<BatchSerialLabelPicker mode="serial" />)
      await screen.findByText('Laptop')
      await act(async () => scanner.onScan('SN-7'))
      expect(showToast).toHaveBeenCalledWith('Added serial SN-7', 'success')
      expect(screen.getByRole('button', { name: 'Download PDF — 1 label' })).toBeInTheDocument()
    })

    it('a scanned product code loads its serials', async () => {
      const f = route({
        ...defaultRoutes(),
        '/scan/resolve': J({ kind: 'item', item: { product_id: 'p1', variant_id: 'v1', name: 'Laptop' } }),
      })
      render(<BatchSerialLabelPicker mode="serial" />)
      await screen.findByText('Laptop')
      await act(async () => scanner.onScan('LP-1'))
      expect(await screen.findByText('SN-1')).toBeInTheDocument()
      expect(f.mock.calls.at(-1)![0]).toBe('/api/admin/inventory/serials/available?product_id=p1&variant_id=v1')
    })

    it('an unknown scan toasts not found', async () => {
      route({ ...defaultRoutes(), '/scan/resolve': J({}) })
      render(<BatchSerialLabelPicker mode="serial" />)
      await screen.findByText('Laptop')
      await act(async () => scanner.onScan('???'))
      expect(showToast).toHaveBeenCalledWith('Not found: ???', 'error')
    })

    it('a product with no in-stock serials says so', async () => {
      route({
        '/labels/serial/products': J({ products: serialProducts }),
        '/inventory/serials/available': J({ serials: [] }),
        '/scan/resolve': J({ item: { product_id: 'p1', name: 'Laptop' } }),
      })
      render(<BatchSerialLabelPicker mode="serial" />)
      await screen.findByText('Laptop')
      await act(async () => scanner.onScan('LP-1'))
      expect(showToast).toHaveBeenCalledWith('No in-stock serials for this product', 'info')
    })

    it('a failed lookup toasts', async () => {
      route({ ...defaultRoutes(), '/scan/resolve': () => Promise.reject(new Error('x')) })
      render(<BatchSerialLabelPicker mode="serial" />)
      await screen.findByText('Laptop')
      await act(async () => scanner.onScan('LP-1'))
      expect(showToast).toHaveBeenCalledWith('Lookup failed', 'error')
    })
  })
})
