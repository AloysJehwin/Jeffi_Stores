import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/certificates/download/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['settings'] }

function makeReq(token?: string) {
  const url = token
    ? `http://localhost/api/admin/certificates/download?token=${token}`
    : 'http://localhost/api/admin/certificates/download'
  return new NextRequest(url, { method: 'GET' })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const CERT = {
  id: 'cert-uuid-1',
  serial_number: 'SN-001',
  common_name: 'admin@example.com',
  expires_at: '2027-01-01T00:00:00Z',
  downloaded_at: null,
  is_revoked: false,
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/certificates/download', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne
      .mockResolvedValueOnce(CERT as any) // SELECT cert
      .mockResolvedValueOnce({ id: 'cert-uuid-1' } as any) // UPDATE downloaded_at
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when settings scope is missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  // ── Input validation ─────────────────────────────────────────────────────

  it('returns 400 when token query param is missing', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/download token required/i)
  })

  // ── Certificate state guards ─────────────────────────────────────────────

  it('returns 404 when certificate not found', async () => {
    mockQueryOne.mockReset().mockResolvedValueOnce(null)
    const res = await GET(makeReq('bad-token'))
    expect(res.status).toBe(404)
  })

  it('returns 410 when certificate was already downloaded', async () => {
    mockQueryOne.mockReset().mockResolvedValueOnce({
      ...CERT,
      downloaded_at: '2026-01-01T00:00:00Z',
    } as any)
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(410)
  })

  it('returns 410 when certificate is revoked', async () => {
    mockQueryOne.mockReset().mockResolvedValueOnce({
      ...CERT,
      is_revoked: true,
    } as any)
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(410)
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('marks certificate as downloaded and returns cert info', async () => {
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.serialNumber).toBe('SN-001')
    expect(body.commonName).toBe('admin@example.com')
    expect(body.expiresAt).toBe('2027-01-01T00:00:00Z')
    expect(mockQueryOne).toHaveBeenCalledTimes(2)
  })

  // ── Error handling ───────────────────────────────────────────────────────

  it('returns 500 on unexpected db error', async () => {
    mockQueryOne.mockReset().mockRejectedValue(new Error('DB error'))
    const res = await GET(makeReq('valid-token'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/internal server error/i)
  })
})
