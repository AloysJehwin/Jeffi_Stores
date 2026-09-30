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

  // ── Delhivery API errors ─────────────────────────────────────────────────

  it('records error and continues when Delhivery returns non-ok', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].error).toContain('503')
  })

  it('records error and continues when fetch throws', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.errors[0].error).toContain('Network timeout')
  })

  it('handles empty ShipmentData array gracefully', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  it('handles missing ShipmentData key gracefully', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
  })

  // ── RVP (reverse pickup) ─────────────────────────────────────────────────
  // NOTE: route returns early when orders.length === 0, so rvp queryMany is
  // never reached. All RVP tests must supply at least one order (with an AWB
  // that won't match the forward-shipment fetch response) so execution reaches
  // the rvp section.

  const noMatchOrder = { ...sampleOrder, awb_number: 'NOMATCH' }

  it('marks return request as received when DestRecieveDate is set', async () => {
    const rvpRequest = {
      id: 'rr-1',
      rvp_awb_number: 'RVP111',
      order_id: 'order-1',
      user_id: 'user-1',
      order_number: 'ORD-001',
    }
    // First fetch: forward order status (returns empty ShipmentData so no sync)
    // Second fetch: RVP tracking
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP111',
                Status: { StatusType: 'DL', Status: 'Delivered', StatusDateTime: '2024-01-15T10:00:00' },
                DestRecieveDate: '2024-01-15',
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)
    mockQueryMany.mockResolvedValueOnce([noMatchOrder]).mockResolvedValueOnce([rvpRequest])

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.received).toBe(1)
    expect(body.rvp.results[0].returnRequestId).toBe('rr-1')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE return_requests'), expect.any(Array))
  })

  it('creates inspect_refund auto task after RVP received', async () => {
    const rvpRequest = {
      id: 'rr-1',
      rvp_awb_number: 'RVP111',
      order_id: 'order-1',
      user_id: 'user-1',
      order_number: 'ORD-001',
    }
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP111',
                Status: { Status: 'Delivered', StatusType: 'DL', StatusDateTime: null },
                DestRecieveDate: '2024-01-15',
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)
    mockQueryMany.mockResolvedValueOnce([noMatchOrder]).mockResolvedValueOnce([rvpRequest])

    await POST(makeReq())
    await new Promise(r => setTimeout(r, 0))
    expect(mockCompleteAutoTask).toHaveBeenCalledWith('schedule_pickup', 'order-1')
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'inspect_refund', userId: 'user-1' })
    )
  })

  it('does not mark RVP received when none of the received signals are present', async () => {
    const rvpRequest = {
      id: 'rr-1',
      rvp_awb_number: 'RVP111',
      order_id: 'order-1',
      user_id: 'user-1',
      order_number: 'ORD-001',
    }
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP111',
                Status: { Status: 'In Transit', StatusType: 'IT', StatusDateTime: null },
                DestRecieveDate: null,
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)
    mockQueryMany.mockResolvedValueOnce([noMatchOrder]).mockResolvedValueOnce([rvpRequest])

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.received).toBe(0)
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE return_requests'), expect.any(Array))
  })

  it('records rvp error when Delhivery returns non-ok for RVP batch', async () => {
    const rvpRequest = {
      id: 'rr-1',
      rvp_awb_number: 'RVP111',
      order_id: 'order-1',
      user_id: 'user-1',
      order_number: 'ORD-001',
    }
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({ ok: false, status: 500 } as any)
    mockQueryMany.mockResolvedValueOnce([noMatchOrder]).mockResolvedValueOnce([rvpRequest])

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.received).toBe(0)
    expect(body.rvp.errors).toHaveLength(1)
    expect(body.rvp.errors[0].error).toContain('500')
  })

  // ── Response structure ───────────────────────────────────────────────────

  it('returns correct top-level response shape', async () => {
    mockQueryMany.mockResolvedValueOnce([sampleOrder]).mockResolvedValueOnce([])
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body).toMatchObject({
      total: 1,
      synced: expect.any(Number),
      results: expect.any(Array),
      rvp: expect.objectContaining({ total: 0, received: 0 }),
    })
    // errors key should be absent when empty
    expect(body.errors).toBeUndefined()
  })
})
