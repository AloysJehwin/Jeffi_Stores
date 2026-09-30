import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/amazon/sync', () => ({
  syncAllProductsToAmazon: vi.fn(),
  syncProductToAmazon: vi.fn(),
  sendAmazonSyncFailureEmail: vi.fn(),
  validateProductForAmazon: vi.fn(),
  dryRunAmazonSync: vi.fn(),
}))

// ── Imports ─────────────────────────────────────────────────────────────────────

import { POST, GET } from '@/app/api/admin/merchant/amazon/sync/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import {
  syncAllProductsToAmazon,
  syncProductToAmazon,
  sendAmazonSyncFailureEmail,
  validateProductForAmazon,
  dryRunAmazonSync,
} from '@/lib/amazon/sync'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockSyncAll = vi.mocked(syncAllProductsToAmazon)
const mockSyncOne = vi.mocked(syncProductToAmazon)
const mockFailEmail = vi.mocked(sendAmazonSyncFailureEmail)
const mockValidate = vi.mocked(validateProductForAmazon)
const mockDryRun = vi.mocked(dryRunAmazonSync)

// ── Helpers ─────────────────────────────────────────────────────────────────────

const HOST = 'admin.jeffistores.in'
const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: [] }

// host / origin / referer are "forbidden" request headers that undici strips
// from a real Headers/fetch init, so we inject them by overriding headers.get.
function withHeaders(req: NextRequest, extra: Record<string, string | undefined>) {
  const orig = req.headers.get.bind(req.headers)
  ;(req.headers as any).get = (k: string) => {
    const v = extra[k.toLowerCase()]
    return v !== undefined ? v : orig(k)
  }
  return req
}

function makePost(
  opts: {
    body?: unknown
    origin?: string | null
    referer?: string | null
    host?: string | null
    xrw?: string | null
  } = {}
) {
  const req = new NextRequest(`https://${HOST}/api/admin/merchant/amazon/sync`, {
    method: 'POST',
    body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {}),
  })
  const extra: Record<string, string | undefined> = {}
  extra.host = opts.host === undefined ? HOST : (opts.host ?? undefined)
  extra.origin = opts.origin === undefined ? `https://${HOST}` : (opts.origin ?? undefined)
  if (opts.referer) extra.referer = opts.referer
  extra['x-requested-with'] = opts.xrw === undefined ? 'jeffi-admin' : (opts.xrw ?? undefined)
  return withHeaders(req, extra)
}

function makeGet(opts: { auth?: string | null } = {}) {
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  return new NextRequest(`https://${HOST}/api/admin/merchant/amazon/sync`, {
    method: 'GET',
    headers,
  })
}

// ── POST — origin / header guards ───────────────────────────────────────────────

describe('POST /api/admin/merchant/amazon/sync — request guards', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 403 when host header is missing', async () => {
    const res = await POST(makePost({ host: null, origin: null }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Cross-origin/)
  })

  it('returns 403 when origin does not match and no referer', async () => {
    const res = await POST(makePost({ origin: 'https://evil.com', referer: null }))
    expect(res.status).toBe(403)
  })

  it('accepts request when referer host matches (no origin header)', async () => {
    mockSyncAll.mockResolvedValue({ synced: 1, errors: [] } as any)
    const res = await POST(makePost({ origin: null, referer: `https://${HOST}/admin/products` }))
    expect(res.status).toBe(200)
  })

  it('returns 403 when referer is malformed and origin absent', async () => {
    const res = await POST(makePost({ origin: null, referer: 'not a url' }))
    expect(res.status).toBe(403)
  })

  it('returns 403 when referer host differs from host', async () => {
    const res = await POST(makePost({ origin: null, referer: 'https://other.com/x' }))
    expect(res.status).toBe(403)
  })

  it('accepts http origin variant', async () => {
    mockSyncAll.mockResolvedValue({ synced: 0, errors: [] } as any)
    const res = await POST(makePost({ origin: `http://${HOST}` }))
    expect(res.status).toBe(200)
  })

  it('returns 403 when x-requested-with header is missing', async () => {
    const res = await POST(makePost({ xrw: null }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Missing required header/)
  })

  it('returns 403 when x-requested-with header is wrong', async () => {
    const res = await POST(makePost({ xrw: 'something-else' }))
    expect(res.status).toBe(403)
  })
})

// ── POST — auth / scope ───────────────────────────────────────────────────────

describe('POST /api/admin/merchant/amazon/sync — auth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost())
    expect(res.status).toBe(401)
  })

  it('returns 403 when lacking products:write scope', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Insufficient/)
  })
})

// ── POST — modes ────────────────────────────────────────────────────────────────

describe('POST /api/admin/merchant/amazon/sync — modes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
  })

  it('validate mode requires productId → 400', async () => {
    const res = await POST(makePost({ body: { mode: 'validate' } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/productId required/)
  })

  it('validate mode returns results when productId present', async () => {
    mockValidate.mockResolvedValue([{ sku: 'X', ok: true }] as any)
    const res = await POST(makePost({ body: { mode: 'validate', productId: 'p1' } }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mode).toBe('validate')
    expect(mockValidate).toHaveBeenCalledWith('p1')
  })

  it('dryrun mode clamps limit and returns report', async () => {
    mockDryRun.mockResolvedValue({ sampled: 100 } as any)
    const res = await POST(makePost({ body: { mode: 'dryrun', limit: 9999 } }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mode).toBe('dryrun')
    expect(mockDryRun).toHaveBeenCalledWith(500) // clamped to max 500
  })

  it('dryrun defaults limit to 100 when not a number', async () => {
    mockDryRun.mockResolvedValue({} as any)
    await POST(makePost({ body: { mode: 'dryrun' } }))
    expect(mockDryRun).toHaveBeenCalledWith(100)
  })

  it('single-product sync when productId given (no mode)', async () => {
    mockSyncOne.mockResolvedValue(undefined as any)
    const res = await POST(makePost({ body: { productId: 'p2' } }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mode).toBe('single')
    expect(mockSyncOne).toHaveBeenCalledWith('p2')
  })

  it('full sync when no productId and no mode', async () => {
    mockSyncAll.mockResolvedValue({ synced: 3, errors: [] } as any)
    const res = await POST(makePost({ body: {} }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.mode).toBe('full')
    expect(data.synced).toBe(3)
    expect(mockFailEmail).not.toHaveBeenCalled()
  })

  it('full sync sends failure email when errors present', async () => {
    const result = { synced: 1, errors: [{ sku: 'X', error: 'boom' }] }
    mockSyncAll.mockResolvedValue(result as any)
    const res = await POST(makePost({ body: {} }))
    expect(res.status).toBe(200)
    expect(mockFailEmail).toHaveBeenCalledWith(result)
  })

  it('handles invalid JSON body (defaults to {})', async () => {
    mockSyncAll.mockResolvedValue({ synced: 0, errors: [] } as any)
    const res = await POST(makePost({ body: '{not json' }))
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('full')
  })

  it('returns 500 when sync throws', async () => {
    mockSyncAll.mockRejectedValue(new Error('SP-API down'))
    const res = await POST(makePost({ body: {} }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('SP-API down')
  })
})

// ── GET — cron / admin ────────────────────────────────────────────────────────

describe('GET /api/admin/merchant/amazon/sync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockHasScope.mockReturnValue(true)
  })

  it('runs full sync when cron secret matches', async () => {
    process.env.CRON_SECRET = 'cron-key'
    mockSyncAll.mockResolvedValue({ synced: 2, errors: [] } as any)
    const res = await GET(makeGet({ auth: 'Bearer cron-key' }))
    expect(res.status).toBe(200)
    expect((await res.json()).synced).toBe(2)
    expect(mockAuth).not.toHaveBeenCalled()
    delete process.env.CRON_SECRET
  })

  it('falls back to admin auth when not cron → 401 unauthenticated', async () => {
    delete process.env.CRON_SECRET
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet({ auth: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when admin lacks products:read scope', async () => {
    delete process.env.CRON_SECRET
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet({ auth: null }))
    expect(res.status).toBe(403)
  })

  it('runs sync for authenticated admin', async () => {
    delete process.env.CRON_SECRET
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockSyncAll.mockResolvedValue({ synced: 5, errors: [] } as any)
    const res = await GET(makeGet({ auth: null }))
    expect(res.status).toBe(200)
    expect((await res.json()).synced).toBe(5)
  })

  it('sends failure email on errors', async () => {
    process.env.CRON_SECRET = 'cron-key'
    const result = { synced: 0, errors: [{ sku: 'Y', error: 'nope' }] }
    mockSyncAll.mockResolvedValue(result as any)
    await GET(makeGet({ auth: 'Bearer cron-key' }))
    expect(mockFailEmail).toHaveBeenCalledWith(result)
    delete process.env.CRON_SECRET
  })

  it('returns 500 when sync throws', async () => {
    process.env.CRON_SECRET = 'cron-key'
    mockSyncAll.mockRejectedValue(new Error('boom'))
    const res = await GET(makeGet({ auth: 'Bearer cron-key' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
    delete process.env.CRON_SECRET
  })
})
