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
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  getScenario: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/admin/campaigns/scenarios/[kind]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, queryMany } from '@/lib/shared/db'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGetScenario = vi.mocked(getScenario)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['mailer'] }

function makeGet(kind: string) {
  return new NextRequest(`http://localhost/api/admin/campaigns/scenarios/${kind}`)
}

function makePatch(kind: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/campaigns/scenarios/${kind}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete(kind: string) {
  return new NextRequest(`http://localhost/api/admin/campaigns/scenarios/${kind}`, {
    method: 'DELETE',
  })
}

const builtinScenario = {
  kind: 'abandoned-cart',
  name: 'Abandoned Cart',
  description: 'Target users who left items in cart',
  trigger: 'When cart is abandoned',
  defaultParams: { sendCooldownDays: 3 },
  paramSchema: { cartValue: { type: 'number' } },
}

const customScenarioRow = {
  kind: 'custom-promo',
  name: 'Custom Promo',
  description: 'My custom scenario',
  ai_prompt: 'Users who bought X',
  generated_sql: 'SELECT id FROM users ...',
  enabled: true,
  dry_run_count: 100,
  parameters: { maxRecipientsPerSweep: 200 },
}

const campaignRow = {
  kind: 'camp-1',
  name: 'Campaign 1',
  enabled: true,
  delay_hours: 0,
  discount_percent: 10,
  parameters: null,
  last_run_at: null,
  total_sent: '50',
  total_opened: '10',
  total_clicked: '5',
  total_converted: '2',
}

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/campaigns/scenarios/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetScenario.mockReturnValue(null)
    mockQueryMany.mockResolvedValue([campaignRow] as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGet('abandoned-cart'), { params: Promise.resolve({ kind: 'abandoned-cart' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet('abandoned-cart'), { params: Promise.resolve({ kind: 'abandoned-cart' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns builtin scenario details', async () => {
    mockGetScenario.mockReturnValue(builtinScenario as any)
    const res = await GET(makeGet('abandoned-cart'), { params: Promise.resolve({ kind: 'abandoned-cart' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenario.type).toBe('builtin')
    expect(body.scenario.kind).toBe('abandoned-cart')
    expect(body.scenario.default_parameters.sendCooldownDays).toBe(3) // builtin.defaultParams overrides universal default
    expect(body.campaigns).toHaveLength(1)
    expect(body.campaigns[0].total_sent).toBe(50)
  })

  it('returns 404 when custom scenario not found', async () => {
    mockGetScenario.mockReturnValue(null)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeGet('nonexistent'), { params: Promise.resolve({ kind: 'nonexistent' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Scenario not found')
  })

  it('returns custom scenario details', async () => {
    mockGetScenario.mockReturnValue(null)
    mockQueryOne.mockResolvedValueOnce(customScenarioRow as any)
    const res = await GET(makeGet('custom-promo'), { params: Promise.resolve({ kind: 'custom-promo' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenario.type).toBe('custom')
    expect(body.scenario.kind).toBe('custom-promo')
    expect(body.scenario.generated_sql).toBe(customScenarioRow.generated_sql)
  })

  it('parses campaign integer counts correctly', async () => {
    mockGetScenario.mockReturnValue(builtinScenario as any)
    mockQueryMany.mockResolvedValueOnce([campaignRow] as any)
    const res = await GET(makeGet('abandoned-cart'), { params: Promise.resolve({ kind: 'abandoned-cart' }) })
    const body = await res.json()
    expect(typeof body.campaigns[0].total_sent).toBe('number')
    expect(body.campaigns[0].total_opened).toBe(10)
    expect(body.campaigns[0].total_clicked).toBe(5)
    expect(body.campaigns[0].total_converted).toBe(2)
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/campaigns/scenarios/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetScenario.mockReturnValue(null)
    mockQueryOne.mockResolvedValue({ kind: 'custom-promo' } as any)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatch('custom-promo', { enabled: false }), {
      params: Promise.resolve({ kind: 'custom-promo' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch('custom-promo', { enabled: false }), {
      params: Promise.resolve({ kind: 'custom-promo' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 when trying to modify builtin scenario', async () => {
    mockGetScenario.mockReturnValue(builtinScenario as any)
    const res = await PATCH(makePatch('abandoned-cart', { enabled: false }), {
      params: Promise.resolve({ kind: 'abandoned-cart' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Built-in scenarios cannot be modified')
  })

  it('returns 404 when custom scenario not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(makePatch('nonexistent', { enabled: false }), {
      params: Promise.resolve({ kind: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Scenario not found')
  })

  it('updates enabled flag', async () => {
    const res = await PATCH(makePatch('custom-promo', { enabled: false }), {
      params: Promise.resolve({ kind: 'custom-promo' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('enabled'),
      expect.arrayContaining([false, 'custom-promo'])
    )
  })

  it('updates name', async () => {
    const res = await PATCH(makePatch('custom-promo', { name: 'New Name' }), {
      params: Promise.resolve({ kind: 'custom-promo' }),
    })
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('name'),
      expect.arrayContaining(['New Name', 'custom-promo'])
    )
  })

  it('updates description (including empty string to null)', async () => {
    const res = await PATCH(makePatch('custom-promo', { description: '' }), {
      params: Promise.resolve({ kind: 'custom-promo' }),
    })
    expect(res.status).toBe(200)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/campaigns/scenarios/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetScenario.mockReturnValue(null)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await DELETE(makeDelete('custom-promo'), { params: Promise.resolve({ kind: 'custom-promo' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete('custom-promo'), { params: Promise.resolve({ kind: 'custom-promo' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 when trying to delete builtin scenario', async () => {
    mockGetScenario.mockReturnValue(builtinScenario as any)
    const res = await DELETE(makeDelete('abandoned-cart'), { params: Promise.resolve({ kind: 'abandoned-cart' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Built-in scenarios cannot be deleted')
  })

  it('returns 404 when custom scenario not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(makeDelete('nonexistent'), { params: Promise.resolve({ kind: 'nonexistent' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Scenario not found')
  })

  it('returns 400 when linked campaigns exist', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ kind: 'custom-promo' } as any) // exists check
      .mockResolvedValueOnce({ count: '3' } as any) // linked campaigns count
    const res = await DELETE(makeDelete('custom-promo'), { params: Promise.resolve({ kind: 'custom-promo' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Cannot delete')
  })

  it('deletes scenario when no linked campaigns', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ kind: 'custom-promo' } as any) // exists check
      .mockResolvedValueOnce({ count: '0' } as any) // no linked campaigns
    const res = await DELETE(makeDelete('custom-promo'), { params: Promise.resolve({ kind: 'custom-promo' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM scenarios'), ['custom-promo'])
  })
})
