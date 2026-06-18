import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  requireAdminScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------

import { GET, POST } from '@/app/api/admin/business/rfqs/[id]/messages/route'
import { requireAdminScope } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['business_rfqs'] }
const RFQ_ID = '880e8400-e29b-41d4-a716-446655440004'

function makeReq(method: string, body?: unknown) {
  const opts: RequestInit = { method }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  return new NextRequest(new Request(
    `http://localhost/api/admin/business/rfqs/${RFQ_ID}/messages`,
    opts,
  ))
}

const OPEN_RFQ = { id: RFQ_ID, status: 'pending' }

const SAMPLE_MESSAGES = [
  {
    id: 'msg-1',
    sender: 'customer',
    message: 'Please quote for 50 units',
    counter_items: null,
    created_at: '2024-04-01T10:00:00Z',
  },
  {
    id: 'msg-2',
    sender: 'admin',
    message: 'We can offer at ₹180/unit',
    counter_items: JSON.stringify([{ rfq_item_id: 'riq-1', offered_price: 180 }]),
    created_at: '2024-04-01T11:00:00Z',
  },
]

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/business/rfqs/[id]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
    vi.mocked(queryOne).mockResolvedValue(OPEN_RFQ as any)
    vi.mocked(queryMany).mockResolvedValue(SAMPLE_MESSAGES as any)
  })

  it('returns 401 when requireAdminScope returns a response', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const res = await GET(makeReq('GET'), { params: { id: RFQ_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when RFQ not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await GET(makeReq('GET'), { params: { id: RFQ_ID } })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Not found')
  })

  it('returns messages array on success', async () => {
    const res = await GET(makeReq('GET'), { params: { id: RFQ_ID } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.messages).toHaveLength(2)
  })

  it('returns empty array when no messages exist', async () => {
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeReq('GET'), { params: { id: RFQ_ID } })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.messages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/business/rfqs/[id]/messages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
    vi.mocked(queryOne).mockResolvedValue(OPEN_RFQ as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when requireAdminScope returns a response', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const res = await POST(makeReq('POST', { message: 'hello' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when RFQ not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makeReq('POST', { message: 'hello' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(404)
  })

  it('returns 400 when RFQ is converted', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: RFQ_ID, status: 'converted' } as any)
    const res = await POST(makeReq('POST', { message: 'hello' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/closed/)
  })

  it('returns 400 when RFQ is rejected', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: RFQ_ID, status: 'rejected' } as any)
    const res = await POST(makeReq('POST', { message: 'hello' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(400)
  })

  it('returns 400 when message is empty string', async () => {
    const res = await POST(makeReq('POST', { message: '   ' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/required/)
  })

  it('returns 400 when message is missing', async () => {
    const res = await POST(makeReq('POST', {}), { params: { id: RFQ_ID } })
    expect(res.status).toBe(400)
  })

  it('returns 400 when counter_items is not an array', async () => {
    const res = await POST(
      makeReq('POST', { message: 'Offer', counter_items: { invalid: true } }),
      { params: { id: RFQ_ID } },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/array/)
  })

  it('returns 400 when counter_items entry is missing rfq_item_id', async () => {
    const res = await POST(
      makeReq('POST', {
        message: 'Offer',
        counter_items: [{ offered_price: 100 }],
      }),
      { params: { id: RFQ_ID } },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/rfq_item_id/)
  })

  it('returns 400 when counter_items entry is missing offered_price', async () => {
    const res = await POST(
      makeReq('POST', {
        message: 'Offer',
        counter_items: [{ rfq_item_id: 'riq-1' }],
      }),
      { params: { id: RFQ_ID } },
    )
    expect(res.status).toBe(400)
  })

  it('inserts message and returns it on success', async () => {
    const insertedMsg = {
      id: 'msg-new',
      sender: 'admin',
      message: 'We can offer at ₹180',
      counter_items: null,
      created_at: '2024-04-02T10:00:00Z',
    }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(OPEN_RFQ as any) // rfq lookup
      .mockResolvedValueOnce(insertedMsg as any) // INSERT RETURNING

    const res = await POST(
      makeReq('POST', { message: 'We can offer at ₹180' }),
      { params: { id: RFQ_ID } },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.message).toMatchObject({ id: 'msg-new', sender: 'admin' })
  })

  it('stores counter_items as JSON string in DB', async () => {
    const counterItems = [{ rfq_item_id: 'riq-1', offered_price: 180 }]
    const insertedMsg = {
      id: 'msg-counter',
      sender: 'admin',
      message: 'Counter offer',
      counter_items: JSON.stringify(counterItems),
      created_at: '2024-04-02T11:00:00Z',
    }
    vi.mocked(queryOne)
      .mockResolvedValueOnce(OPEN_RFQ as any)
      .mockResolvedValueOnce(insertedMsg as any)

    const res = await POST(
      makeReq('POST', { message: 'Counter offer', counter_items: counterItems }),
      { params: { id: RFQ_ID } },
    )
    expect(res.status).toBe(200)

    // The INSERT should have been called with JSON-serialized counter_items
    const insertCall = vi.mocked(queryOne).mock.calls[1]
    expect(insertCall[1]).toContain(JSON.stringify(counterItems))
  })

  it('moves RFQ to negotiating when status is pending', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: RFQ_ID, status: 'pending' } as any)
      .mockResolvedValueOnce({ id: 'msg-new', sender: 'admin', message: 'Hi', counter_items: null, created_at: new Date().toISOString() } as any)

    await POST(makeReq('POST', { message: 'Hi' }), { params: { id: RFQ_ID } })

    const updateCall = vi.mocked(query).mock.calls.find(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes("status = 'negotiating'"),
    )
    expect(updateCall).toBeDefined()
  })

  it('moves RFQ to negotiating when status is reviewed', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: RFQ_ID, status: 'reviewed' } as any)
      .mockResolvedValueOnce({ id: 'msg-new', sender: 'admin', message: 'Hi', counter_items: null, created_at: new Date().toISOString() } as any)

    await POST(makeReq('POST', { message: 'Hi' }), { params: { id: RFQ_ID } })

    const updateCall = vi.mocked(query).mock.calls.find(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes("status = 'negotiating'"),
    )
    expect(updateCall).toBeDefined()
  })

  it('does NOT update status when already negotiating', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: RFQ_ID, status: 'negotiating' } as any)
      .mockResolvedValueOnce({ id: 'msg-new', sender: 'admin', message: 'Hi', counter_items: null, created_at: new Date().toISOString() } as any)

    await POST(makeReq('POST', { message: 'Hi' }), { params: { id: RFQ_ID } })

    const updateCall = vi.mocked(query).mock.calls.find(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes("status = 'negotiating'"),
    )
    expect(updateCall).toBeUndefined()
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(OPEN_RFQ as any)
      .mockRejectedValueOnce(new Error('DB error'))

    const res = await POST(makeReq('POST', { message: 'Hello' }), { params: { id: RFQ_ID } })
    expect(res.status).toBe(500)
  })
})
