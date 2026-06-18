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
  queryMany: vi.fn(),
}))

vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  listScenarios: vi.fn(),
  getScenario: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/campaigns/scenarios/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import { listScenarios, getScenario } from '@/lib/campaigns/scenarios/_registry'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockListScenarios = vi.mocked(listScenarios)
const mockGetScenario = vi.mocked(getScenario)

// ── Helpers ───────────────────────────────────────────────────────────────────

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: ['mailer'],
}

function makeRequest() {
  return new NextRequest('http://localhost/api/admin/campaigns/scenarios', {
    method: 'GET',
    headers: { cookie: 'admin_token=valid-token' },
  })
}

const sampleScenario = {
  kind: 'abandoned_cart',
  name: 'Abandoned Cart',
  description: 'Send email to users who abandoned cart',
  trigger: 'cart_abandoned',
  defaultParams: { discountPercent: 10 },
  paramSchema: { discountPercent: { type: 'integer', min: 0, max: 100, label: 'Discount %' } },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/campaigns/scenarios', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when mailer scope is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/insufficient/i)
  })

  it('returns scenarios list on success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListScenarios.mockReturnValue([sampleScenario] as any)
    mockGetScenario.mockReturnValue(sampleScenario as any)
    // aggregates query, campaign rows query, custom scenarios query
    mockQueryMany
      .mockResolvedValueOnce([]) // aggregates
      .mockResolvedValueOnce([]) // campaign rows
      .mockResolvedValueOnce([]) // custom scenarios
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.scenarios)).toBe(true)
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0].kind).toBe('abandoned_cart')
    expect(body.scenarios[0].type).toBe('builtin')
  })

  it('populates stats from aggregates when available', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListScenarios.mockReturnValue([sampleScenario] as any)
    mockGetScenario.mockReturnValue(sampleScenario as any)
    const agg = {
      scenario_kind: 'abandoned_cart',
      campaigns_count: '3',
      total_sent: '100',
      total_opened: '50',
      total_clicked: '20',
      total_converted: '5',
      last_run_at: '2026-06-01T00:00:00Z',
    }
    mockQueryMany
      .mockResolvedValueOnce([agg])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scenarios[0].stats.total_sent).toBe(100)
    expect(body.scenarios[0].stats.campaigns_count).toBe(3)
    expect(body.scenarios[0].stats.last_run_at).toBe('2026-06-01T00:00:00Z')
  })

  it('includes campaigns grouped by scenario', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListScenarios.mockReturnValue([sampleScenario] as any)
    mockGetScenario.mockReturnValue(sampleScenario as any)
    const campaignRow = {
      scenario_kind: 'abandoned_cart',
      kind: 'abandoned_cart_default',
      name: 'Abandoned Cart Default',
      enabled: true,
      delay_hours: 2,
      discount_percent: 10,
      last_run_at: null,
    }
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([campaignRow])
      .mockResolvedValueOnce([])
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.scenarios[0].campaigns).toHaveLength(1)
    expect(body.scenarios[0].campaigns[0].kind).toBe('abandoned_cart_default')
  })

  it('appends custom scenarios not in builtin registry', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListScenarios.mockReturnValue([])
    mockGetScenario.mockReturnValue(undefined) // not in registry
    const customRow = {
      kind: 'my_custom_scenario',
      name: 'My Custom',
      description: 'Custom description',
      ai_prompt: 'Send to VIP users',
      enabled: true,
      dry_run_count: 5,
      parameters: { sendCooldownDays: 3 },
      approved_at: null,
    }
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customRow])
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0].type).toBe('custom')
    expect(body.scenarios[0].kind).toBe('my_custom_scenario')
  })

  it('skips custom scenarios that are already in builtin registry', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockListScenarios.mockReturnValue([sampleScenario] as any)
    mockGetScenario.mockReturnValue(sampleScenario as any) // exists in registry
    const customRow = {
      kind: 'abandoned_cart',
      name: 'Duplicate',
      description: null,
      ai_prompt: 'prompt',
      enabled: true,
      dry_run_count: null,
      parameters: null,
      approved_at: null,
    }
    mockQueryMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customRow])
    const res = await GET(makeRequest())
    const body = await res.json()
    // should only have 1 (the builtin), custom duplicate is skipped
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0].type).toBe('builtin')
  })
})
