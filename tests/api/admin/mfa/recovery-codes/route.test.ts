import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/auth/mfa', () => ({
  generateRecoveryCodes: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/mfa/recovery-codes/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { generateRecoveryCodes } from '@/lib/auth/mfa'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockGenerateCodes = vi.mocked(generateRecoveryCodes)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: [],
}

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/mfa/recovery-codes', {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid' },
  })
}

function makePostRequest() {
  return new NextRequest('http://localhost/api/admin/mfa/recovery-codes', {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/mfa/recovery-codes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('returns mfa status and remaining codes', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne
      .mockResolvedValueOnce({ mfa_enabled: true, mfa_enrolled_at: '2024-01-01T00:00:00Z' })
      .mockResolvedValueOnce({ remaining: '8' })

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mfa_enabled).toBe(true)
    expect(body.mfa_enrolled_at).toBe('2024-01-01T00:00:00Z')
    expect(body.recovery_codes_remaining).toBe(8)
  })

  it('returns mfa_enabled false when row is null', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ remaining: '0' })

    const res = await GET(makeGetRequest())
    const body = await res.json()
    expect(body.mfa_enabled).toBe(false)
    expect(body.mfa_enrolled_at).toBeNull()
  })

  it('returns 0 remaining when codes row is null', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValueOnce({ mfa_enabled: false, mfa_enrolled_at: null }).mockResolvedValueOnce(null)

    const res = await GET(makeGetRequest())
    const body = await res.json()
    expect(body.recovery_codes_remaining).toBe(0)
  })
})

describe('POST /api/admin/mfa/recovery-codes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when MFA is not enabled', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue({ mfa_enabled: false })

    const res = await POST(makePostRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not enabled/i)
  })

  it('generates and returns 10 new recovery codes', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue({ mfa_enabled: true })
    const fakeCodes = Array.from({ length: 10 }, (_, i) => ({
      plain: `CODE-${i.toString().padStart(4, '0')}`,
      hash: `hash-${i}`,
    }))
    mockGenerateCodes.mockReturnValue(fakeCodes)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await POST(makePostRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recovery_codes).toHaveLength(10)
    expect(body.recovery_codes[0]).toBe('CODE-0000')
    // DELETE old codes + 10 INSERTs = 11 query calls
    expect(mockQuery).toHaveBeenCalledTimes(11)
  })

  it('deletes old codes before inserting new ones', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue({ mfa_enabled: true })
    mockGenerateCodes.mockReturnValue([{ plain: 'CODE-1', hash: 'h1' }])
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)

    await POST(makePostRequest())

    const firstCall = mockQuery.mock.calls[0][0] as string
    expect(firstCall).toContain('DELETE')
  })
})
