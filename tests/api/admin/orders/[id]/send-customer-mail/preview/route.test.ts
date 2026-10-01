import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/template-vars', () => ({
  buildVarMap: vi.fn().mockReturnValue({ recipient_first_name: 'Alice' }),
  substituteVars: vi.fn().mockImplementation((t: string) => t),
}))

import { POST } from '@/app/api/(admin)/admin/orders/[id]/send-customer-mail/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['orders:read'] }
const params = Promise.resolve({ id: 'ord-1' })
const ORDER = {
  order_number: '1001',
  customer_name: 'Alice Smith',
  customer_email: 'alice@example.com',
  users: { email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryOne).mockResolvedValue(ORDER as any)
})

function makeReq(body: unknown) {
  return new NextRequest('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/orders/[id]/send-customer-mail/preview', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makeReq({ subject: 'Hi', body: 'Hello' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns html preview on happy path', async () => {
    const res = await POST(makeReq({ subject: 'Test', body: 'Hello {{recipient_first_name}}' }), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.html).toContain('<!DOCTYPE html>')
  })

  it('handles order with no users (fallback to customer_name)', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      order_number: '1002',
      customer_name: 'Bob Jones',
      customer_email: 'bob@example.com',
      users: null,
    } as any)
    const res = await POST(makeReq({ body: 'Hi' }), { params })
    expect(res.status).toBe(200)
  })

  it('handles malformed JSON body (empty body fallback)', async () => {
    const req = new NextRequest('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)
  })

  it('handles order with no users.last_name', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      order_number: '1003',
      customer_name: 'Carol',
      customer_email: 'carol@example.com',
      users: { email: 'carol@example.com', first_name: 'Carol', last_name: null },
    } as any)
    const res = await POST(makeReq({ body: 'Hi' }), { params })
    expect(res.status).toBe(200)
  })
})
