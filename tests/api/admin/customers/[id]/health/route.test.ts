import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/customer-health', () => ({
  getHealth: vi.fn(),
  recomputeHealth: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/customers/[id]/health/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getHealth, recomputeHealth } from '@/lib/customer-health'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetHealth = vi.mocked(getHealth)
const mockRecomputeHealth = vi.mocked(recomputeHealth)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'super_admin',
  scopes: ['customers'],
}

function makeGetRequest(id = 'user-1') {
  return new NextRequest(`http://localhost/api/admin/customers/${id}/health`, {
    method: 'GET',
    headers: { cookie: 'admin_sid=valid' },
  })
}

function makePostRequest(id = 'user-1') {
  return new NextRequest(`http://localhost/api/admin/customers/${id}/health`, {
    method: 'POST',
    headers: { cookie: 'admin_sid=valid' },
  })
}

const sampleHealth = {
  score: 85,
  churnRisk: 'healthy',
  ordersLast90: 5,
  avgOrderValue: 1200,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/customers/[id]/health', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns customer health data', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetHealth.mockResolvedValue(sampleHealth as any)

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.health).toEqual(sampleHealth)
    expect(mockGetHealth).toHaveBeenCalledWith('user-1')
  })

  it('returns health as null when not computed yet', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGetHealth.mockResolvedValue(null)

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.health).toBeNull()
  })
})

describe('POST /api/admin/customers/[id]/health', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when user not found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockRecomputeHealth.mockResolvedValue(null)

    const res = await POST(makePostRequest('user-999'), { params: Promise.resolve({ id: 'user-999' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('recomputes and returns updated health', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockRecomputeHealth.mockResolvedValue(sampleHealth as any)

    const res = await POST(makePostRequest(), { params: Promise.resolve({ id: 'user-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.health).toEqual(sampleHealth)
    expect(mockRecomputeHealth).toHaveBeenCalledWith('user-1')
  })
})
