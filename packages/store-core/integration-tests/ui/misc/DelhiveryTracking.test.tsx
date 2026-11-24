import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DelhiveryTracking from '@/components/DelhiveryTracking'

const scan = (activity: string, over: Record<string, any> = {}) => ({ date: '2026-03-05T10:15:00Z', location: 'Chennai Hub', activity, instructions: null, ...over })
const tracking = (over: Record<string, any> = {}) => ({
  awb: 'AWB123456',
  status: 'Shipment in transit<br/>to Mumbai',
  statusType: 'IT',
  shipmentStatus: 'in_transit',
  statusDateTime: null,
  pickUpDate: '2026-03-03T09:00:00Z',
  expectedDelivery: '2026-03-08T00:00:00Z',
  origin: 'Chennai',
  destination: 'Mumbai',
  scans: [scan('In Transit'), scan('Picked Up', { location: 'Chennai' })],
  ...over,
})
const respond = (t: any, extra: Record<string, any> = {}) => vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ tracking: t, ...extra })))

describe('DelhiveryTracking (customer view)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows a loading line, then the status, AWB, route and dates', async () => {
    respond(tracking())
    render(<DelhiveryTracking orderId="o1" />)
    expect(screen.getByText('Loading tracking…')).toBeInTheDocument()
    expect(await screen.findByText('In Transit', { selector: 'span.rounded-full' })).toBeInTheDocument()
    expect(screen.getByText('AWB123456')).toBeInTheDocument()
    expect(screen.getByText('Shipment in transit to Mumbai')).toBeInTheDocument()
    expect(screen.getByText('Chennai', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Mumbai', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Expected Delivery')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/orders/o1/track', undefined)
  })

  it('draws the delivery timeline with the right steps', async () => {
    respond(tracking())
    render(<DelhiveryTracking orderId="o1" />)
    await screen.findByText('AWB123456')
    for (const s of ['Shipment Created', 'Picked Up', 'Out for Delivery', 'Delivered']) expect(screen.getAllByText(s).length).toBeGreaterThan(0)
  })

  it('draws the return timeline for a pickup order', async () => {
    respond(tracking({ orderType: 'Pickup', shipmentStatus: 'created', statusType: 'PP' }))
    render(<DelhiveryTracking orderId="o1" />)
    expect(await screen.findByText('Pickup Scheduled')).toBeInTheDocument()
    expect(screen.getByText('Received')).toBeInTheDocument()
  })

  it('opens and closes the shipment history', async () => {
    respond(tracking())
    render(<DelhiveryTracking orderId="o1" />)
    fireEvent.click(await screen.findByRole('button', { name: /View history \(2\)/ }))
    expect(screen.getByText('Shipment History')).toBeInTheDocument()
    expect(screen.getByText('Chennai Hub')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByText('Shipment History').parentElement!.querySelector('button')!)
    expect(screen.queryByText('Shipment History')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('prefers the stored shipment status when it is further along than the live one', async () => {
    respond(tracking({ statusType: 'PP', shipmentStatus: 'out_for_delivery', scans: [] }))
    render(<DelhiveryTracking orderId="o1" />)
    expect(await screen.findByText('Out for Delivery', { selector: 'span.rounded-full' })).toBeInTheDocument()
  })

  it('reads a stale exception from the scans (an exception code that was actually delivered)', async () => {
    respond(tracking({ statusType: 'UD', shipmentStatus: null, scans: [scan('Delivered')] }))
    render(<DelhiveryTracking orderId="o1" />)
    expect(await screen.findByText('Delivered', { selector: 'span.rounded-full' })).toBeInTheDocument()
  })

  it('uses the stored status when the live status is missing, and labels returns', async () => {
    respond(tracking({ statusType: null, shipmentStatus: 'rto_in_transit', scans: [] }))
    render(<DelhiveryTracking orderId="o1" />)
    expect(await screen.findByText('Returning to Origin')).toBeInTheDocument()
  })

  it('says tracking is unavailable when the API returns an error or no data', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No shipment yet' })))
    const a = render(<DelhiveryTracking orderId="o1" />)
    expect(await screen.findByText('No shipment yet')).toBeInTheDocument()
    a.unmount()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ tracking: null })))
    const b = render(<DelhiveryTracking orderId="o2" />)
    expect(await screen.findByText('Tracking information not yet available.')).toBeInTheDocument()
    b.unmount()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    render(<DelhiveryTracking orderId="o3" />)
    expect(await screen.findByText('Could not load tracking')).toBeInTheDocument()
  })

  it('never shows delivery cost to customers', async () => {
    respond(tracking({ shippingAmount: 90, billedAmount: 150, freightCharge: 140 }))
    render(<DelhiveryTracking orderId="o1" />)
    await screen.findByText('AWB123456')
    expect(screen.queryByText('Delivery Cost')).toBeNull()
  })

  it('uses a custom api base, track path and headers', async () => {
    respond(tracking())
    render(<DelhiveryTracking orderId="o9" apiBase="/api/business/orders" trackPath="shipment" headers={{ 'X-Auth-Portal': 'business' }} />)
    await screen.findByText('AWB123456')
    expect(fetch).toHaveBeenCalledWith('/api/business/orders/o9/shipment', { headers: { 'X-Auth-Portal': 'business' } })
  })
})

describe('DelhiveryTracking (admin view)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('shows route and dates inline, refreshes live, and reports an automatic status sync', async () => {
    respond(tracking())
    render(<DelhiveryTracking orderId="o1" variant="admin" />)
    expect(await screen.findByText(/Origin:/)).toBeInTheDocument()
    expect(screen.getByText(/Dest:/)).toBeInTheDocument()
    respond(tracking(), { statusSynced: true, syncedTo: 'shipped' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live' }))
    expect(await screen.findByText('shipped')).toBeInTheDocument()
    expect(screen.getByText(/automatically updated to/)).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toBe('/api/orders/o1/track?refresh=1')
  })

  it('flags a shipment exception', async () => {
    respond(tracking({ statusType: 'NDR', shipmentStatus: 'delivery_attempted' }))
    render(<DelhiveryTracking orderId="o1" variant="admin" />)
    expect(await screen.findByText(/Shipment exception:/)).toBeInTheDocument()
    expect(screen.getAllByText('Delivery Attempted').length).toBeGreaterThan(0)
  })

  it('shows quoted cost with an over-quote delta and the actual invoice breakdown', async () => {
    respond(
      tracking({
        shippingAmount: 100,
        quotedWeightKg: 1,
        chargedWeightKg: 2.5,
        billedAmount: 160,
        billedAt: '2026-03-10T00:00:00Z',
        freightCharge: 120,
        codCharge: 25,
        odaCharge: 15,
      })
    )
    render(<DelhiveryTracking orderId="o1" variant="admin" />)
    expect(await screen.findByText('Delivery Cost')).toBeInTheDocument()
    expect(screen.getByText('Actual invoice')).toBeInTheDocument()
    expect(screen.getByText('₹100.00')).toBeInTheDocument()
    expect(screen.getAllByText('₹160.00')).toHaveLength(2)
    expect(screen.getByText(/\+₹60\.00 over quote/)).toBeInTheDocument()
    expect(screen.getByText(/2\.5 kg ↑/)).toBeInTheDocument()
    expect(screen.getByText('COD handling')).toBeInTheDocument()
    expect(screen.getByText('ODA surcharge')).toBeInTheDocument()
    expect(screen.getByText('₹120.00')).toBeInTheDocument()
    expect(screen.getByText('Total billed')).toBeInTheDocument()
  })

  it('shows an estimate when only an extra charge is known, and an under-quote delta when billed less', async () => {
    respond(tracking({ shippingAmount: 100, extraCharge: 30 }))
    const a = render(<DelhiveryTracking orderId="o1" variant="admin" />)
    expect(await screen.findByText('Estimate')).toBeInTheDocument()
    expect(screen.getByText('Est. total')).toBeInTheDocument()
    expect(screen.getByText(/\+₹30\.00 over quote \(est\.\)/)).toBeInTheDocument()
    a.unmount()
    respond(tracking({ shippingAmount: 100, billedAmount: 80, freightCharge: 80 }))
    render(<DelhiveryTracking orderId="o2" variant="admin" />)
    expect(await screen.findByText(/−₹20\.00 under quote/)).toBeInTheDocument()
  })

  it('records a revised delivery charge and reloads', async () => {
    respond(tracking({ shippingAmount: 100 }))
    render(<DelhiveryTracking orderId="o1" variant="admin" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enter Delhivery charge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter the charged weight or the charged amount')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('2.78'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText(/Weight must be a number in kg/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('2.78'), { target: { value: '2.78' } })
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }))).mockResolvedValue(new Response(JSON.stringify({ tracking: tracking({ shippingAmount: 100 }) })))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByPlaceholderText('2.78')).toBeNull())
    const post = vi.mocked(fetch).mock.calls.find(c => (c[1] as any)?.method === 'POST')!
    expect(post[0]).toBe('/api/orders/o1/delivery-charge')
    expect(JSON.parse((post[1] as any).body)).toEqual({ chargedWeightKg: 2.78, chargedAmount: null })
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(c => String(c[0]).includes('refresh=1'))).toBe(true))
  })

  it('shows the server reason when saving the delivery charge fails, and can cancel', async () => {
    respond(tracking({ shippingAmount: 100, chargedWeightKg: 1.5 }))
    render(<DelhiveryTracking orderId="o1" variant="admin" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Update delivery charge' }))
    expect(screen.getByPlaceholderText('2.78')).toHaveValue(1.5)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Rate lookup failed' }), { status: 502 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Rate lookup failed')).toBeInTheDocument()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Not Found</html>', { status: 404 }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByPlaceholderText('2.78')).toBeNull()
  })
})
