import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/ui/CopySku', () => ({ default: () => null }))

const controls = { stop: vi.fn() }
let onFrame: ((result: any, err: any, ctrl: any) => Promise<void>) | undefined
let cameraFails = false
const decodeFromConstraints = vi.fn()
vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints(c: any, v: any, cb: any) {
      decodeFromConstraints(c, v, cb)
      onFrame = cb
      return cameraFails ? Promise.reject(new Error('denied')) : Promise.resolve(controls)
    }
  },
}))

import ScanClient from '@admin/app/(admin)/admin/scan/ScanClient'

const order = { id: 'o1', order_number: 'ORD-1', status: 'confirmed', payment_status: 'paid', customer_name: 'Asha Rao' }
const item = {
  id: 'v1', product_id: 'p1', variant_id: 'v1', name: 'Power Drill', variant_name: '18V', sku: 'DR-18', slug: 'drill', mrp: 1500, price_ex_gst: 1000,
  base_price: 1000, gst_percentage: 18, brand_name: 'Bosch', category_name: 'Tools', gtin: '8901234567890', stock_status: 'in_stock',
  inventory_quantity: 3, is_active: true, has_variants: true, image_url: 'https://cdn.test/d.png',
}
const json = (ok: boolean, body: unknown = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })
const fetchMock = vi.fn()
let orderRes: any
let productRes: any

async function scan(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Start Scanning' }))
  await waitFor(() => expect(onFrame).toBeDefined())
  await act(async () => {
    await onFrame!({ getText: () => text }, undefined, controls)
  })
}

describe('ScanClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    onFrame = undefined
    cameraFails = false
    orderRes = json(true, { order })
    productRes = json(true, { item })
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/orders/by-number')) return orderRes
      if (url.startsWith('/api/admin/products/by-sku')) return productRes
      if (url.startsWith('/api/admin/shelving/stock')) return json(true, { locations: [{ location_display_code: 'A-01-2', quantity: 3 }] })
      if (init?.method === 'PATCH') return json(true, {})
      return json(true)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('starts on the idle screen and opens the camera with the rear-facing constraint', async () => {
    render(asAdmin(<ScanClient />))
    expect(screen.getByText('Enter order number manually')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start Scanning' }))
    expect(await screen.findByText('Point at any QR code')).toBeInTheDocument()
    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled())
    expect(decodeFromConstraints.mock.calls[0][0]).toEqual({ video: { facingMode: 'environment' } })
  })

  it('shows an error when the camera is denied', async () => {
    cameraFails = true
    render(asAdmin(<ScanClient />))
    fireEvent.click(screen.getByRole('button', { name: 'Start Scanning' }))
    expect(await screen.findByText('Camera access denied or unavailable.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(screen.getByRole('button', { name: 'Start Scanning' })).toBeInTheDocument()
  })

  it('an ORD- code looks the order up and offers the next status', async () => {
    render(asAdmin(<ScanClient />))
    await scan(' ORD-1 ')
    expect(await screen.findByText('Order Found')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/by-number?q=ORD-1')
    expect(screen.getByText('#ORD-1')).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as Processing' })).toBeInTheDocument()
    expect(controls.stop).toHaveBeenCalled()
  })

  it('marking processing PATCHes the order and ends on the Done screen', async () => {
    render(asAdmin(<ScanClient />))
    await scan('ORD-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Processing' }))
    expect(await screen.findByText('Done!')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(url).toBe('/api/orders/o1')
    expect(JSON.parse(init.body)).toEqual({ status: 'processing', payment_status: 'paid' })
    expect(showToast).toHaveBeenCalledWith('Order #ORD-1 marked Processing.', 'success')
    fireEvent.click(screen.getByRole('button', { name: 'Scan Next' }))
    expect(screen.getByRole('button', { name: 'Start Scanning' })).toBeInTheDocument()
  })

  it('shipping requires a tracking URL before it confirms', async () => {
    orderRes = json(true, { order: { ...order, status: 'processing' } })
    render(asAdmin(<ScanClient />))
    await scan('ORD-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Shipped' }))
    const confirm = await screen.findByRole('button', { name: 'Confirm Shipped' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/track\.delhivery/), { target: { value: ' https://t.test/1 ' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(await screen.findByText('Done!')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(init.body)).toEqual({ status: 'shipped', payment_status: 'paid', tracking_url: 'https://t.test/1' })
    expect(showToast).toHaveBeenCalledWith('Order #ORD-1 marked Shipped.', 'success')
  })

  it('cancelling the shipping sheet returns to the order', async () => {
    orderRes = json(true, { order: { ...order, status: 'processing' } })
    render(asAdmin(<ScanClient />))
    await scan('ORD-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Shipped' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Order Found')).toBeInTheDocument()
  })

  it('shows the error screen and toast when the status update fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.startsWith('/api/admin/orders/by-number')) return orderRes
      if (init?.method === 'PATCH') return json(false, { error: 'Invalid transition' }, 400)
      return json(true)
    })
    render(asAdmin(<ScanClient />))
    await scan('ORD-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Processing' }))
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Invalid transition')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Invalid transition', 'error')
  })

  it('hides status updates without quick_scan write access and for terminal statuses', async () => {
    render(asMember(<ScanClient />, ['quick_scan:read']))
    await scan('ORD-1')
    expect(await screen.findByText('No further status updates available for this order.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as/ })).not.toBeInTheDocument()
  })

  it('a non-order code looks the product up and shows price, stock, brand and shelves', async () => {
    render(asAdmin(<ScanClient />))
    await scan('DR-18')
    expect(await screen.findByText('Product Details')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/products/by-sku?q=DR-18')
    expect(screen.getByText('Power Drill')).toBeInTheDocument()
    expect(screen.getByText('18V')).toBeInTheDocument()
    expect(screen.getByText('Rs. 1180.00')).toBeInTheDocument()
    expect(screen.getByText('Rs. 1770.00')).toBeInTheDocument()
    expect(screen.getByText('Rs. 1000.00')).toBeInTheDocument()
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(screen.getByText('8901234567890')).toBeInTheDocument()
    expect(await screen.findByText('A-01-2')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/admin/shelving/stock'))![0])).toContain('variant_id=v1')
    fireEvent.click(screen.getByRole('button', { name: 'Scan Next' }))
    expect(await screen.findByText('Point at any QR code')).toBeInTheDocument()
  })

  it('shows "Not assigned to any shelf" when the stock lookup fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/products/by-sku')) return productRes
      return json(false, {}, 500)
    })
    render(asAdmin(<ScanClient />))
    await scan('DR-18')
    expect(await screen.findByText('Not assigned to any shelf')).toBeInTheDocument()
  })

  it('a 404 shows Not found and Try Again resets', async () => {
    productRes = json(false, {}, 404)
    render(asAdmin(<ScanClient />))
    await scan('NOPE')
    expect(await screen.findByText('Not found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(screen.getByRole('button', { name: 'Start Scanning' })).toBeInTheDocument()
  })

  it('shows the server message when the product lookup fails', async () => {
    productRes = json(false, { error: 'SKU service down' }, 500)
    render(asAdmin(<ScanClient />))
    await scan('DR-18')
    expect(await screen.findByText('SKU service down')).toBeInTheDocument()
  })

  it('manual entry looks the order up on click and with Enter, and needs input', async () => {
    render(asAdmin(<ScanClient />))
    fireEvent.click(screen.getByText('Enter order number manually'))
    const lookUp = screen.getByRole('button', { name: 'Look Up' })
    expect(lookUp).toBeDisabled()
    const input = screen.getByPlaceholderText(/ORD-1777399568448/)
    fireEvent.change(input, { target: { value: 'ORD-1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Order Found')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/orders/by-number?q=ORD-1')
  })

  it('manual lookup shows the connection error when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(asAdmin(<ScanClient />))
    fireEvent.click(screen.getByText('Enter order number manually'))
    fireEvent.change(screen.getByPlaceholderText(/ORD-1777399568448/), { target: { value: 'ORD-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))
    expect(await screen.findByText('Could not look up order. Check your connection.')).toBeInTheDocument()
  })

  it('stops the camera when leaving the scan screen with the close button', async () => {
    render(asAdmin(<ScanClient />))
    fireEvent.click(screen.getByRole('button', { name: 'Start Scanning' }))
    await waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled())
    await act(async () => {})
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(controls.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Start Scanning' })).toBeInTheDocument()
  })
})
