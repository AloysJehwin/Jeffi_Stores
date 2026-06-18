import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/shelf', () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: 'zNonEmpty',
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/shelving/warehouses/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { listWarehouses, createWarehouse } from '@/lib/shelf'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockListWarehouses = vi.mocked(listWarehouses)
const mockCreateWarehouse = vi.mocked(createWarehouse)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['inventory'],
}

function makeRequest(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/shelving/warehouses', {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: 'admin_token=valid-token',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/shelving/warehouses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/forbidden/i)
  })

  it('returns warehouses list on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const warehouses = [{ id: 'wh-1', name: 'Main Warehouse' }]
    mockListWarehouses.mockResolvedValue(warehouses as any)
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warehouses).toEqual(warehouses)
  })

  it('returns 500 on DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListWarehouses.mockRejectedValue(new Error('DB failure'))
    const res = await GET(makeRequest('GET'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB failure')
  })
})

describe('POST /api/admin/shelving/warehouses', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest('POST', { name: 'WH', code: 'WH01' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest('POST', { name: 'WH', code: 'WH01' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest('POST', { code: 'WH01' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/name required/i)
  })

  it('returns 400 when code is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest('POST', { name: 'Main WH' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/code required/i)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'Validation failed' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makeRequest('POST', { name: 'WH', code: 'WH01' }))
    expect(res.status).toBe(422)
  })

  it('creates warehouse and returns 201 on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    const warehouse = { id: 'wh-1', name: 'Main WH', code: 'WH01' }
    mockCreateWarehouse.mockResolvedValue(warehouse as any)
    const res = await POST(makeRequest('POST', { name: 'Main WH', code: 'WH01' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.warehouse).toEqual(warehouse)
  })

  it('returns 409 on duplicate code (unique constraint)', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    const dupError = new Error('duplicate key unique constraint violation')
    mockCreateWarehouse.mockRejectedValue(dupError)
    const res = await POST(makeRequest('POST', { name: 'Main WH', code: 'WH01' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/i)
  })

  it('returns 409 when error code is 23505', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    const dupError = Object.assign(new Error('pg error'), { code: '23505' })
    mockCreateWarehouse.mockRejectedValue(dupError)
    const res = await POST(makeRequest('POST', { name: 'Main WH', code: 'WH01' }))
    expect(res.status).toBe(409)
  })

  it('returns 500 on unexpected DB error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true } as any)
    mockCreateWarehouse.mockRejectedValue(new Error('Connection reset'))
    const res = await POST(makeRequest('POST', { name: 'Main WH', code: 'WH01' }))
    expect(res.status).toBe(500)
  })
})
