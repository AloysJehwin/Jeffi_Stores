import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/campaigns/template-validation', () => ({
  validateCampaignBodyTemplate: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/campaigns/[kind]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { validateCampaignBodyTemplate } from '@/lib/campaigns/template-validation'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockValidateTemplate = vi.mocked(validateCampaignBodyTemplate)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['mailer'] }

function makeGet(kind: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/admin/campaigns/${kind}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

function makePatch(kind: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/campaigns/${kind}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleCampaign = { kind: 'welcome', name: 'Welcome', enabled: true, delay_hours: 0 }
const sampleSends = [{ id: 's1', user_email: 'a@b.com', user_name: 'Alice', sent_at: '2024-01-01' }]

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/campaigns/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGet('welcome'), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet('welcome'), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns 404 when campaign not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeGet('nonexistent'), { params: Promise.resolve({ kind: 'nonexistent' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Campaign not found')
  })

  it('returns campaign with recent sends and total', async () => {
    mockQueryOne.mockResolvedValueOnce(sampleCampaign as any)
    mockQueryMany.mockResolvedValueOnce(sampleSends as any)
    mockQueryOne.mockResolvedValueOnce({ total: '5' } as any)

    const res = await GET(makeGet('welcome'), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.campaign).toEqual(sampleCampaign)
    expect(body.recentSends).toEqual(sampleSends)
    expect(body.total).toBe(5)
    expect(body.limit).toBe(20)
    expect(body.offset).toBe(0)
  })

  it('handles offset query param', async () => {
    mockQueryOne.mockResolvedValueOnce(sampleCampaign as any)
    mockQueryMany.mockResolvedValueOnce([] as any)
    mockQueryOne.mockResolvedValueOnce({ total: '50' } as any)

    const res = await GET(makeGet('welcome', { offset: '20' }), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.offset).toBe(20)
  })

  it('handles null countRow gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce(sampleCampaign as any)
    mockQueryMany.mockResolvedValueOnce([] as any)
    mockQueryOne.mockResolvedValueOnce(null)

    const res = await GET(makeGet('welcome'), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
  })

  it('includes whatsappLogs in the response', async () => {
    const waLogs = [
      { to_number: '+919876543210', body: 'We miss you!', status: 'sent', error: null, sent_at: '2024-01-02' },
    ]
    mockQueryOne.mockResolvedValueOnce(sampleCampaign as any) // campaign lookup
    mockQueryMany
      .mockResolvedValueOnce(sampleSends as any) // recentSends
      .mockResolvedValueOnce(waLogs as any) // whatsappLogs
    mockQueryOne.mockResolvedValueOnce({ total: '1' } as any) // count

    const res = await GET(makeGet('welcome'), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.whatsappLogs).toEqual(waLogs)
  })
})

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/admin/campaigns/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatch('welcome', { enabled: true }), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch('welcome', { enabled: true }), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(403)
  })

  it('updates enabled flag', async () => {
    const res = await PATCH(makePatch('welcome', { enabled: false }), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('enabled'),
      expect.arrayContaining([false, 'welcome'])
    )
  })

  it('updates delay_hours within valid range', async () => {
    const res = await PATCH(makePatch('welcome', { delay_hours: 48 }), { params: Promise.resolve({ kind: 'welcome' }) })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('delay_hours'),
      expect.arrayContaining([48, 'welcome'])
    )
  })

  it('ignores delay_hours out of range (>720)', async () => {
    const res = await PATCH(makePatch('welcome', { delay_hours: 999 }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(200)
    // Query still called but without delay_hours param in SET
    const callArgs = mockQuery.mock.calls[0]
    expect(callArgs[0]).not.toContain('delay_hours')
  })

  it('updates discount_percent within valid range', async () => {
    const res = await PATCH(makePatch('welcome', { discount_percent: 10 }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('discount_percent'),
      expect.arrayContaining([10, 'welcome'])
    )
  })

  it('updates subject_template', async () => {
    const res = await PATCH(makePatch('welcome', { subject_template: 'Hello {{name}}' }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 400 when body_template validation fails', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: 'abandoned-cart' } as any)
    mockValidateTemplate.mockReturnValueOnce({
      ok: false,
      reason: 'Missing required variable',
      hint: 'Add {{name}}',
    } as any)
    const res = await PATCH(makePatch('welcome', { body_template: '<p>Bad template</p>' }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Missing required variable')
    expect(body.hint).toBe('Add {{name}}')
  })

  it('updates body_template when validation passes', async () => {
    mockQueryOne.mockResolvedValueOnce({ scenario_kind: 'welcome' } as any)
    mockValidateTemplate.mockReturnValueOnce({ ok: true } as any)
    const res = await PATCH(makePatch('welcome', { body_template: '<p>Hello {{name}}</p>' }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 400 when scenario_kind is seeded and change attempted', async () => {
    // First queryOne call: no scenario_kind (or different), second: seeded check returns row
    mockQueryOne
      .mockResolvedValueOnce({ scenario_kind: null } as any) // current
      .mockResolvedValueOnce({ kind: 'welcome' } as any) // seeded check
    const res = await PATCH(makePatch('welcome', { scenario_kind: 'new-kind' }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Cannot change scenario on a seeded campaign')
  })

  it('returns 400 when unknown scenario_kind provided', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ scenario_kind: null } as any) // current
      .mockResolvedValueOnce(null) // seeded check — not seeded
      .mockResolvedValueOnce(null) // exists check — does not exist
    const res = await PATCH(makePatch('welcome', { scenario_kind: 'nonexistent-scenario' }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown scenario_kind')
  })

  it('updates parameters object', async () => {
    const res = await PATCH(makePatch('welcome', { parameters: { foo: 'bar' } }), {
      params: Promise.resolve({ kind: 'welcome' }),
    })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('parameters'),
      expect.arrayContaining(['{"foo":"bar"}', 'welcome'])
    )
  })
})
