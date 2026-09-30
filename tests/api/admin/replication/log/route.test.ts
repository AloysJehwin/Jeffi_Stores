import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

// The GET handler uses next/headers cookies() — mock it
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  verifyToken: vi.fn(),
  authenticateServiceAccount: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST, GET } from '@/app/api/admin/replication/log/route'
import { verifyToken, authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'
import { cookies } from 'next/headers'

const mockVerifyToken = vi.mocked(verifyToken)
const mockAuthenticateAdmin = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockCookies = vi.mocked(cookies)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON_SECRET = 'test-cron-secret' // matches vitest.config.ts env

function makePost(body: unknown, authHeader?: string) {
  return new NextRequest('http://localhost/api/admin/replication/log', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authHeader !== undefined ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  })
}

function makeGet(params: Record<string, string> = {}, tokenValue?: string) {
  const url = new URL('http://localhost/api/admin/replication/log')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  // cookies() is mocked per-test
  return new NextRequest(url)
}

const validRunBody = {
  run_id: 'repl-20240115T120000Z',
  status: 'ok' as const,
  duration_seconds: 45,
  row_count: 10000,
}

// ── Tests: POST ───────────────────────────────────────────────────────────────

describe('POST /api/admin/replication/log', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/replication/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRunBody),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 401 when token is wrong', async () => {
    const res = await POST(makePost(validRunBody, 'Bearer wrong-token'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when body is invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/admin/replication/log', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CRON_SECRET}`,
      },
      body: 'NOT JSON',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid json/i)
  })

  it('returns 400 when run_id is missing', async () => {
    const { run_id, ...noRunId } = validRunBody
    const res = await POST(makePost(noRunId, `Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/run_id/i)
  })

  it('returns 400 when status is invalid', async () => {
    const res = await POST(makePost({ ...validRunBody, status: 'unknown' }, `Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/status must be one of/i)
  })

  it('accepts all valid status values', async () => {
    for (const status of ['ok', 'failed', 'partial', 'started'] as const) {
      vi.clearAllMocks()
      mockQuery.mockResolvedValue(undefined as any)
      const res = await POST(makePost({ ...validRunBody, status }, `Bearer ${CRON_SECRET}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.run_id).toBe(validRunBody.run_id)
    }
  })

  it('inserts replication run record on happy path', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    const res = await POST(makePost(validRunBody, `Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO replication_runs'),
      expect.arrayContaining([validRunBody.run_id, 'razer', 'ok'])
    )
  })

  it('derives started_at from run_id timestamp format', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    await POST(makePost(validRunBody, `Bearer ${CRON_SECRET}`))
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    // queryArgs[3] is started_at — should be a Date parsed from the run_id
    const startedAt = queryArgs[3]
    expect(startedAt).toBeInstanceOf(Date)
    expect(isNaN((startedAt as Date).getTime())).toBe(false)
  })

  it('uses provided started_at over run_id derivation', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    const explicit = '2024-03-10T08:30:00Z'
    await POST(makePost({ ...validRunBody, started_at: explicit }, `Bearer ${CRON_SECRET}`))
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    const startedAt = queryArgs[3] as Date
    expect(startedAt.toISOString()).toBe(new Date(explicit).toISOString())
  })

  it('passes null for optional fields when not provided', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    const minimalBody = { run_id: 'repl-20240115T120000Z', status: 'started' }
    await POST(makePost(minimalBody, `Bearer ${CRON_SECRET}`))
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    expect(queryArgs).toContain(null)
  })

  it('uses custom source when provided', async () => {
    mockQuery.mockResolvedValue(undefined as any)
    await POST(makePost({ ...validRunBody, source: 'custom-box' }, `Bearer ${CRON_SECRET}`))
    const queryArgs = mockQuery.mock.calls[0][1] as any[]
    expect(queryArgs).toContain('custom-box')
  })
})

// ── Tests: GET ────────────────────────────────────────────────────────────────

describe('GET /api/admin/replication/log', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 when no admin_sid cookie', async () => {
    mockAuthenticateAdmin.mockResolvedValue(null as any)
    mockHasScope.mockReturnValue(false)

    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when token is invalid', async () => {
    mockAuthenticateAdmin.mockResolvedValue(null as any)
    mockHasScope.mockReturnValue(false)

    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuthenticateAdmin.mockResolvedValue({ role: 'viewer', scopes: [] } as any)
    mockHasScope.mockReturnValue(false)

    const res = await GET(makeGet())
    expect(res.status).toBe(403)
  })

  it('returns run list on happy path', async () => {
    mockAuthenticateAdmin.mockResolvedValue({ role: 'super_admin', scopes: ['replication'] } as any)
    mockHasScope.mockReturnValue(true)

    const sampleRuns = [{ id: 1, run_id: 'repl-20240115T120000Z', status: 'ok', source: 'razer' }]
    mockQueryMany.mockResolvedValue(sampleRuns as any)

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runs).toHaveLength(1)
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
  })

  it('respects limit and offset query params', async () => {
    mockAuthenticateAdmin.mockResolvedValue({ role: 'super_admin', scopes: ['replication'] } as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ limit: '10', offset: '20' }))
    const body = await res.json()
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(20)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), [10, 20])
  })

  it('caps limit at 200', async () => {
    mockAuthenticateAdmin.mockResolvedValue({ role: 'super_admin', scopes: ['replication'] } as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ limit: '9999' }))
    const body = await res.json()
    expect(body.limit).toBe(200)
  })

  it('clamps offset to 0 minimum', async () => {
    mockAuthenticateAdmin.mockResolvedValue({ role: 'super_admin', scopes: ['replication'] } as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ offset: '-50' }))
    const body = await res.json()
    expect(body.offset).toBe(0)
  })
})
