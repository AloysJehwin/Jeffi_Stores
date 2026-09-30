import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/merchant/sync', () => ({
  syncAllProductsToMerchant: vi.fn(),
  syncProductToMerchant: vi.fn(),
  sendSyncFailureEmail: vi.fn(),
}))

import { POST, GET } from '@/app/api/admin/merchant/sync/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { syncAllProductsToMerchant, syncProductToMerchant, sendSyncFailureEmail } from '@/lib/merchant/sync'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockSyncAll = vi.mocked(syncAllProductsToMerchant)
const mockSyncOne = vi.mocked(syncProductToMerchant)
const mockSyncFailEmail = vi.mocked(sendSyncFailureEmail)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }

/**
 * Build a POST NextRequest where happy-dom won't strip the `host` header.
 * happy-dom treats `host` as a forbidden header and silently drops it, which
 * makes isSameOriginRequest() return false immediately.  We work around this
 * by overriding `headers.get` on the constructed request so the route sees
 * the values it needs.
 */
function makePostReq(body: any = {}, extraHeaders: Record<string, string> = {}) {
  const req = new NextRequest('http://localhost/api/admin/merchant/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  const overrides: Record<string, string> = {
    host: 'localhost',
    origin: 'http://localhost',
    'x-requested-with': 'jeffi-admin',
    ...extraHeaders,
  }
  const originalGet = req.headers.get.bind(req.headers)
  Object.defineProperty(req, 'headers', {
    value: {
      get: (name: string) => {
        const lower = name.toLowerCase()
        if (lower in overrides) return overrides[lower] ?? null
        return originalGet(name)
      },
    },
    writable: false,
  })
  return req
}

function makeGetReq(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/admin/merchant/sync', { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret-123'
})

describe('POST /api/admin/merchant/sync', () => {
  it('returns 403 when cross-origin (no origin/referer)', async () => {
    const req = new NextRequest('http://localhost/api/admin/merchant/sync', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Cross-origin/)
  })

  it('returns 403 when x-requested-with header missing', async () => {
    const req = makePostReq({}, { 'x-requested-with': '' })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Missing required header/)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostReq())
    expect(res.status).toBe(403)
  })

  it('syncs single product when productId provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSyncOne.mockResolvedValue(undefined)
    const res = await POST(makePostReq({ productId: 'prod-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('single')
    expect(mockSyncOne).toHaveBeenCalledWith('prod-1')
  })

  it('syncs all products on full sync', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSyncAll.mockResolvedValue({ synced: 10, errors: [] } as any)
    const res = await POST(makePostReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.mode).toBe('full')
    expect(mockSyncFailEmail).not.toHaveBeenCalled()
  })

  it('sends failure email when sync has errors', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const result = { synced: 5, errors: ['product:p1 failed'] }
    mockSyncAll.mockResolvedValue(result as any)
    mockSyncFailEmail.mockResolvedValue(undefined)
    const res = await POST(makePostReq())
    expect(res.status).toBe(200)
    expect(mockSyncFailEmail).toHaveBeenCalledWith(result)
  })

  it('returns 500 when sync throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSyncAll.mockRejectedValue(new Error('sync failed'))
    const res = await POST(makePostReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('sync failed')
  })
})

describe('GET /api/admin/merchant/sync', () => {
  it('returns 200 for valid cron bearer token', async () => {
    mockSyncAll.mockResolvedValue({ synced: 3, errors: [] } as any)
    const res = await GET(makeGetReq({ authorization: 'Bearer cron-secret-123' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it('returns 401 when no cron token and unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when no cron token and scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
  })

  it('syncs all for admin with products scope', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSyncAll.mockResolvedValue({ synced: 7, errors: [] } as any)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.synced).toBe(7)
  })

  it('sends failure email when sync has errors', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const result = { synced: 2, errors: ['p2 failed'] }
    mockSyncAll.mockResolvedValue(result as any)
    mockSyncFailEmail.mockResolvedValue(undefined)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(200)
    expect(mockSyncFailEmail).toHaveBeenCalledWith(result)
  })

  it('returns 500 when sync throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSyncAll.mockRejectedValue(new Error('network error'))
    const res = await GET(makeGetReq())
    expect(res.status).toBe(500)
  })
})
