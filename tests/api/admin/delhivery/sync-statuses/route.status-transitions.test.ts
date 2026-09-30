import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/delhivery/sync-statuses/route'
import { query, queryMany } from '@/lib/shared/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { createAutoTask, completeAutoTask } from '@/lib/shared/auto-tasks'

// ── Helpers ────────────────────────────────────────────────────────────────

const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockSendStatusUpdate = vi.mocked(sendOrderStatusUpdate)
const mockCreateAutoTask = vi.mocked(createAutoTask)
const mockCompleteAutoTask = vi.mocked(completeAutoTask)

function makeReq(overrides: { auth?: string } = {}) {
  const auth = overrides.auth !== undefined ? overrides.auth : `Bearer ${process.env.CRON_SECRET}`
  return new NextRequest('http://localhost/api/admin/delhivery/sync-statuses', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })
}

const sampleOrder = {
  id: 'order-1',
  awb_number: 'AWB111',
  status: 'shipped',
  order_number: 'ORD-001',
  customer_name: 'Alice Smith',
  customer_email: 'alice@example.com',
  user_id: 'user-1',
}

function makeShipmentResponse(awb: string, statusType: string, statusLabel = 'In Transit') {
  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: awb,
          Status: {
            StatusType: statusType,
            Status: statusLabel,
            StatusDateTime: '2024-01-15T10:00:00',
          },
          Scans: [],
          DestRecieveDate: null,
          ReturnedDate: null,
        },
      },
    ],
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/delhivery/sync-statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the queryMany Once-queue so stale entries from prior tests don't bleed in
    mockQueryMany.mockReset()
    mockQuery.mockReset()
    // Default: no orders, no RVP requests
    mockQueryMany.mockResolvedValue([])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as any)
  })

  // ── Auth ─────────────────────────────────────────────────────────────────

  it('returns 401 when authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/delhivery/sync-statuses', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 401 when Bearer token is wrong', async () => {
    const res = await POST(makeReq({ auth: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 401 when authorization is not Bearer format', async () => {
    const res = await POST(makeReq({ auth: 'Basic abc123' }))
    expect(res.status).toBe(401)
  })

  // ── No orders ────────────────────────────────────────────────────────────

  it('returns synced:0 when no active AWB orders exist', async () => {
    // orders empty → early return, rvp queryMany never called
    mockQueryMany.mockResolvedValueOnce([])
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ synced: 0, total: 0 })
  })

  // ── Successful sync ──────────────────────────────────────────────────────

  it('syncs shipped → out_for_delivery status (OD)', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'OD', 'Out for Delivery'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(1)
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE orders'), expect.any(Array))
  })

  it('syncs to delivered status (DL)', async () => {
    const order = { ...sampleOrder, status: 'out_for_delivery' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'DL', 'Delivered'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('delivered')
  })

  it('syncs processing → shipped status (PU)', async () => {
    const order = { ...sampleOrder, status: 'processing' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'PU', 'Picked Up'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('sends email notification on status change', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'OD', 'Out for Delivery'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    await POST(makeReq())
    await new Promise(r => setTimeout(r, 0))
    expect(mockSendStatusUpdate).toHaveBeenCalledWith(
      'alice@example.com',
      'Alice Smith',
      'ORD-001',
      'order-1',
      'out_for_delivery',
      'shipped'
    )
  })

  it('skips status update when onlyIfCurrent does not match', async () => {
    // DL requires onlyIfCurrent: out_for_delivery/shipped/processing/confirmed
    // Order is already 'delivered' so skip
    const order = { ...sampleOrder, status: 'delivered' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'DL', 'Delivered'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
    // shipment_status write may still fire; assert STATUS_SYNC status write did not
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining("status = 'delivered'"), expect.any(Array))
  })

  it('skips unknown status types', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'XX', 'Unknown'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  it('skips shipment whose AWB does not match any order in batch', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB999', 'OD', 'Out for Delivery'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  // ── RTO handling ─────────────────────────────────────────────────────────

  it('creates auto task when RTO status is received and user_id is set', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'RTO', 'Returned'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    await POST(makeReq())
    await new Promise(r => setTimeout(r, 0))
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'address_rto', userId: 'user-1' })
    )
  })

  it('does not create auto task for RTO when user_id is null', async () => {
    const order = { ...sampleOrder, user_id: null }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'RTO', 'Returned'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    await POST(makeReq())
    await new Promise(r => setTimeout(r, 0))
    expect(mockCreateAutoTask).not.toHaveBeenCalled()
  })

  it('clears AWB on RTO-DL (returned to origin)', async () => {
    const order = { ...sampleOrder, status: 'shipped' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentResponse('AWB111', 'RTO-DL', 'Returned'),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('returned')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('awb_number = NULL'), expect.any(Array))
  })

  // ── Exception type resolution ─────────────────────────────────────────────

  it('resolves UD exception type to DL when status label is "delivered"', async () => {
    const order = { ...sampleOrder, status: 'out_for_delivery' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'AWB111',
                Status: { StatusType: 'UD', Status: 'Delivered', StatusDateTime: null },
                Scans: [],
              },
            },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('delivered')
  })

  it('resolves NDR exception to OD when status label is "out for delivery"', async () => {
    const order = { ...sampleOrder, status: 'shipped' }
    mockQueryMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'AWB111',
                Status: { StatusType: 'NDR', Status: 'Out for Delivery', StatusDateTime: null },
                Scans: [],
              },
            },
          ],
        }),
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
  })
})
