import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { asAdmin, asMember } from '../_support'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/delhivery', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const showToast = vi.fn<(...a: any[]) => any>()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }), useToastOptional: () => ({ showToast }) }))
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({ value, onChange }: any) => <input aria-label="pickup-date" value={value} onChange={e => onChange(e.target.value)} />,
}))
vi.mock('@/components/admin/site-controls/controls', () => ({
  TextControl: ({ label, initial }: any) => <div>{label}={initial}</div>,
  TextAreaControl: ({ label, initial }: any) => <div>{label}={initial}</div>,
}))
vi.mock('@/components/admin/AdminSelect', () => ({
  default: ({ value, onChange, options, placeholder, disabled }: any) => (
    <select aria-label={placeholder ?? `sel:${options[0].label}`} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">--</option>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}))
vi.mock('@admin/app/(admin)/admin/delhivery/_components/EligibleOrdersMobileList', () => ({ default: () => null }))
vi.mock('@admin/app/(admin)/admin/delhivery/_components/PickupHistoryMobileList', () => ({ default: () => null }))

import DelhiveryPageClient from '@admin/app/(admin)/admin/delhivery/DelhiveryPageClient'

const dw = { pickupLocation: 'Main WH', sellerName: 'Jeffi', sellerAddress: '12 Industrial Area', sellerPhone: '9876543210', originPincode: '560001' }
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', order_number: 'ORD-1', awb_number: 'AWB111', status: 'processing', created_at: '2026-03-01T10:00:00Z',
  customer_name: 'Asha Rao', city: 'Pune', state: 'MH', postal_code: '411001', ...over,
})
const orders = [order(), order({ id: 'o2', order_number: 'ORD-2', awb_number: 'AWB222', customer_name: 'Ravi', city: 'Delhi', state: 'DL', postal_code: '110001' })]
const pickup = (over: Record<string, unknown> = {}) => ({
  id: 'r1', pickup_id: 'DL-77', pickup_date: '2026-03-05', awb_count: 1, awbs: ['AWB900'], raw_response: null, pickup_status: 'pending', created_at: '2026-03-04T08:00:00Z', ...over,
})
const locations = [
  { name: 'Main WH', pin: '560001', phone: '1', address: '12 Industrial Area', active: true },
  { name: 'Pune WH', pin: '411001', phone: '2', address: 'Hinjewadi', active: true },
  { name: 'Old WH', pin: '110001', phone: '3', address: 'Gone', active: false },
]
const fetchMock = vi.fn()
const json = (ok: boolean, body: unknown = {}) => ({ ok, json: async () => body, blob: async () => new Blob(['pdf']) })
let history: any[]
const reload = vi.fn()

const draw = (scopes = ['delhivery:write'], mode: 'flagship' | 'own' | 'platform' = 'flagship') =>
  render(asMember(<DelhiveryPageClient deliveryMode={mode} defaultWarehouse={dw} />, scopes))

describe('DelhiveryPageClient', () => {
  beforeEach(() => {
    history = [pickup()]
    showToast.mockReset()
    reload.mockReset()
    const realLoc = window.location
    vi.stubGlobal('location', new Proxy(realLoc, { get: (t, k) => (k === 'reload' ? reload : Reflect.get(t, k, t)) }))
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/delhivery/pickup-locations') return json(true, { locations })
      if (url === '/api/admin/delhivery/pickup-request' && !init?.method) return json(true, { orders, pickupHistory: history })
      if (url === '/api/admin/delhivery/pickup-request' && init?.method === 'POST') return json(true, { orderCount: 2, pickupDate: '2026-03-06' })
      if (url === '/api/admin/delhivery/pickup-request' && init?.method === 'PATCH') return json(true, { awb: 'AWB111' })
      return json(true, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }))
  })

  it('shows the own-account note only for own delivery mode', async () => {
    const { unmount } = draw(['delhivery:write'], 'own')
    expect(screen.getByText('Delhivery Account')).toBeInTheDocument()
    unmount()
    draw()
    expect(screen.queryByText('Delhivery Account')).not.toBeInTheDocument()
  })

  it('lists eligible orders sorted as received, all selected, with destination', async () => {
    draw()
    expect(await screen.findByRole('link', { name: '#ORD-1' })).toHaveAttribute('href', expect.stringContaining('/admin/orders/o1/view'))
    expect(screen.getByText('2 found')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument()
    expect(screen.getByText('Pune, MH, 411001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request Pickup — 2 orders/ })).toBeInTheDocument()
  })

  it('shows the empty state when no orders are eligible', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('pickup-locations') ? json(true, { locations: [] }) : json(true, { orders: [], pickupHistory: [] })))
    draw()
    expect(await screen.findByText(/No eligible orders/)).toBeInTheDocument()
  })

  it('lets staff deselect an order, which updates the request label', async () => {
    draw()
    await screen.findByText('2 of 2 selected')
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request Pickup — 1 order$/ })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByText('0 of 2 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Request Pickup — 0 orders/ })).toBeDisabled()
  })

  it('submits the pickup request with the selected ids, date and warehouse, then reloads', async () => {
    draw()
    fireEvent.click(await screen.findByRole('button', { name: /Request Pickup — 2 orders/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Pickup request sent for 2 orders on 2026-03-06.', expect.anything()))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/delhivery/pickup-request' && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ orderIds: ['o1', 'o2'], pickupLocation: 'Main WH' })
    expect(JSON.parse(post[1].body).pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows the server error with details when the request fails', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return json(false, { error: 'Delhivery rejected', details: 'Pincode unserviceable' })
      if (url.endsWith('pickup-locations')) return json(true, { locations })
      return json(true, { orders, pickupHistory: history })
    })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: /Request Pickup/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Delhivery rejected Pincode unserviceable', expect.anything()))
  })

  it('hides write actions without the delhivery write scope', async () => {
    draw(['delhivery:read'])
    await screen.findByText('2 found')
    expect(screen.queryByRole('button', { name: /Request Pickup/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add warehouse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Labels' })).toBeInTheDocument()
  })

  it('shows the pickup history with AWBs, status and the label download', async () => {
    draw()
    expect(await screen.findByText('DL-77')).toBeInTheDocument()
    expect(screen.getByText('AWB900')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/delhivery/pickup-request/r1/labels', { credentials: 'include' }))
  })

  it('reports a label failure from the server', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url.endsWith('/labels')) return json(false, { error: 'No labels available' })
      if (url.endsWith('pickup-locations')) return json(true, { locations })
      return json(true, { orders, pickupHistory: history })
    })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: 'Labels' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No labels available', expect.anything()))
  })

  it('changes a request status through PATCH and reflects it', async () => {
    draw()
    await screen.findByText('DL-77')
    fireEvent.change(screen.getByLabelText('sel:Pending'), { target: { value: 'picked_up' } })
    await waitFor(() => expect(screen.getByText('picked up')).toBeInTheDocument())
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ id: 'r1', pickup_status: 'picked_up' })
  })

  it('refresh polls the pickup and reports an updated status', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/delhivery/pickup-request?poll=r1') return json(true, { updated: true, pickup_status: 'picked_up' })
      if (url.endsWith('pickup-locations')) return json(true, { locations })
      return json(true, { orders, pickupHistory: history })
    })
    draw()
    await screen.findByText('DL-77')
    fireEvent.click(screen.getByTitle('Poll AWB tracking for live pickup status'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Pickup #DL-77 status updated to picked up.', expect.anything()))
  })

  it('refresh reports no change', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('?poll=')) return json(true, { updated: false, pickup_status: 'pending' })
      if (url.endsWith('pickup-locations')) return json(true, { locations })
      return json(true, { orders, pickupHistory: history })
    })
    draw()
    await screen.findByText('DL-77')
    fireEvent.click(screen.getByTitle('Poll AWB tracking for live pickup status'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('No change — still pending.', expect.anything()))
  })

  it('adds an eligible order to an existing pickup and removes it from the eligible list', async () => {
    draw()
    await screen.findByText('DL-77')
    fireEvent.click(screen.getByRole('button', { name: '+ Add AWB' }))
    fireEvent.change(screen.getByLabelText('— select an order —'), { target: { value: 'o1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('AWB AWB111 added to pickup request.', expect.anything()))
    const patch = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body)).toEqual({ id: 'r1', add_awb_order_id: 'o1' })
    await waitFor(() => expect(screen.getByText('1 found')).toBeInTheDocument())
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('lists warehouses, adds one, and validates required fields', async () => {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (url === '/api/admin/delhivery/pickup-locations/create') return json(true, { name: 'Goa WH' })
      if (url === '/api/admin/delhivery/pickup-locations') return json(true, { locations })
      return json(true, { orders, pickupHistory: history })
    })
    draw()
    expect(await screen.findByText('3 registered')).toBeInTheDocument()
    expect(screen.getAllByText('Pune WH').length).toBeGreaterThan(0)
    expect(screen.getByText('inactive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Add warehouse' }))
    const add = screen.getByRole('button', { name: 'Add warehouse' })
    expect(add).toBeDisabled()
    const inputs = document.querySelectorAll('.grid input')
    fireEvent.change(inputs[0], { target: { value: 'Goa WH' } })
    fireEvent.change(inputs[1], { target: { value: '999' } })
    fireEvent.change(inputs[2], { target: { value: '403001' } })
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'Panaji' } })
    expect(add).toBeEnabled()
    fireEvent.click(add)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Warehouse "Goa WH" added.', expect.anything()))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/delhivery/pickup-locations/create')!
    expect(JSON.parse(post[1].body)).toMatchObject({ name: 'Goa WH', phone: '999', pincode: '403001', address: 'Panaji' })
  })

  it('sets another warehouse as default and reloads the page', async () => {
    draw()
    await screen.findAllByText('Pune WH')
    fireEvent.click(screen.getAllByRole('button', { name: 'Set as default' })[0])
    await waitFor(() => expect(reload).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/admin/delhivery/pickup-locations/set-default')!
    expect(JSON.parse(post[1].body)).toEqual({ name: 'Pune WH' })
  })

  it('removes a warehouse and toasts, or toasts the server error', async () => {
    draw()
    await screen.findAllByText('Pune WH')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Warehouse "Pune WH" removed.', expect.anything()))
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/deactivate') ? json(false, { error: 'In use' }) : url.endsWith('pickup-locations') ? json(true, { locations }) : json(true, { orders, pickupHistory: history }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('In use', expect.anything()))
  })

  it('expands the default warehouse to edit its identity settings', async () => {
    draw()
    await screen.findByText('Main WH')
    fireEvent.click(screen.getByText('Default').closest('button')!)
    expect(screen.getByText('Pickup location name=Main WH')).toBeInTheDocument()
    expect(screen.getByText('Pickup pincode=560001')).toBeInTheDocument()
  })
})
