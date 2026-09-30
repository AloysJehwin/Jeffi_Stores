import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/marketing', () => ({
  getCampaign: vi.fn(),
}))

vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  getScenario: vi.fn(),
}))

vi.mock('@/lib/campaigns/types', () => ({
  resolveParams: vi.fn().mockReturnValue({ sendCooldownDays: 7 }),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('@/lib/campaigns/sql-safety', () => ({
  validateScenarioSql: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/(admin)/admin/campaigns/[kind]/eligible/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getCampaign } from '@/lib/shared/marketing'
import { getScenario } from '@/lib/campaigns/scenarios/_registry'
import { resolveParams } from '@/lib/campaigns/types'
import { queryMany, queryOne, getClient } from '@/lib/shared/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['mailer'] }
const CAMPAIGN_KIND = 'welcome_new_customer'

function makeReq() {
  return new NextRequest(new Request(`http://localhost/api/admin/campaigns/${CAMPAIGN_KIND}/eligible`))
}

const CAMPAIGN = {
  kind: CAMPAIGN_KIND,
  name: 'Welcome New Customer',
  parameters: { sendCooldownDays: 7 },
  scenario_kind: undefined,
}

const SCENARIO = {
  trigger: 'signup',
  description: 'Targets new signups in the last 24h',
  paramSchema: { sendCooldownDays: { type: 'number', default: 7 } },
  defaultParams: { sendCooldownDays: 7 },
  findEligible: vi.fn(),
  findSuppressed: undefined,
}

const ELIGIBLE_ROWS = [
  { id: 'row-1', user_id: 'user-uuid-1' },
  { id: 'row-2', user_id: 'user-uuid-2' },
]

const USERS = [
  { id: 'user-uuid-1', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith', marketing_opt_out: false },
  { id: 'user-uuid-2', email: 'bob@example.com', first_name: 'Bob', last_name: null, marketing_opt_out: true },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/campaigns/[kind]/eligible', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getCampaign).mockResolvedValue(CAMPAIGN as any)
    vi.mocked(getScenario).mockReturnValue(SCENARIO as any)
    vi.mocked(resolveParams).mockReturnValue({ sendCooldownDays: 7 })
    vi.mocked(SCENARIO.findEligible).mockResolvedValue(ELIGIBLE_ROWS)
    vi.mocked(queryMany).mockResolvedValue(USERS as any)
  })

  // --- Auth ---

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when mailer scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    expect(res.status).toBe(403)
  })

  // --- Campaign not found ---

  it('returns 404 when campaign not found', async () => {
    vi.mocked(getCampaign).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Campaign not found')
  })

  // --- Built-in scenario ---

  it('returns eligible recipients for builtin scenario', async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.eligible).toHaveLength(2)
    expect(json.total).toBe(2)
    expect(json.scenarioKind).toBe(CAMPAIGN_KIND)
  })

  it('maps user data onto eligible rows', async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    const alice = json.eligible.find((r: any) => r.user_id === 'user-uuid-1')
    expect(alice.user_email).toBe('alice@example.com')
    expect(alice.user_name).toBe('Alice Smith')
    expect(alice.marketing_opt_out).toBe(false)
  })

  it('returns empty eligible when findEligible returns nothing', async () => {
    vi.mocked(SCENARIO.findEligible).mockResolvedValue([])
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.eligible).toHaveLength(0)
    expect(json.total).toBe(0)
  })

  it('returns 500 when findEligible throws', async () => {
    vi.mocked(SCENARIO.findEligible).mockRejectedValue(new Error('query timeout'))
    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/query timeout/)
  })

  it('includes suppressed list when findSuppressed is defined', async () => {
    const scenarioWithSuppressed = {
      ...SCENARIO,
      findSuppressed: vi.fn().mockResolvedValue([
        {
          id: 'sup-1',
          user_id: 'user-uuid-2',
          reason: 'sent_recently',
          reason_detail: null,
          blocked_until: null,
          raw: {},
        },
      ]),
    }
    vi.mocked(getScenario).mockReturnValue(scenarioWithSuppressed as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.suppressed).toHaveLength(1)
    expect(json.suppressedTotal).toBe(1)
  })

  it('suppressed is empty array when findSuppressed throws', async () => {
    const scenarioWithFailingSuppressed = {
      ...SCENARIO,
      findSuppressed: vi.fn().mockRejectedValue(new Error('suppressed failed')),
    }
    vi.mocked(getScenario).mockReturnValue(scenarioWithFailingSuppressed as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.suppressed).toHaveLength(0)
  })

  it('uses campaign.scenario_kind when set', async () => {
    vi.mocked(getCampaign).mockResolvedValue({ ...CAMPAIGN, scenario_kind: 'cart_abandoners' } as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    // getScenario should be called with 'cart_abandoners'
    expect(getScenario).toHaveBeenCalledWith('cart_abandoners')
  })

  // --- No scenario registered ---

  it('returns note when no scenario registered for campaign', async () => {
    vi.mocked(getScenario).mockReturnValue(undefined as any)
    vi.mocked(queryOne).mockResolvedValue(null as any) // no custom scenario either

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.eligible).toHaveLength(0)
    expect(json.note).toMatch(/No automation scenario/)
  })

  // --- Custom scenario ---

  it('runs custom SQL scenario and returns eligible users', async () => {
    vi.mocked(getScenario).mockReturnValue(undefined as any)

    const customScenario = {
      kind: CAMPAIGN_KIND,
      generated_sql: 'SELECT u.id FROM users u WHERE u.is_active = TRUE LIMIT $3',
      product_sql: null,
      enabled: true,
      description: 'Custom scenario',
      ai_prompt: 'Active users',
    }
    vi.mocked(queryOne).mockResolvedValue(customScenario as any)
    vi.mocked(validateScenarioSql).mockReturnValue({ ok: true, normalized: customScenario.generated_sql } as any)

    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN READ ONLY
        .mockResolvedValueOnce(undefined) // SET statement_timeout
        .mockResolvedValueOnce(undefined) // SET lock_timeout
        .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1' }, { id: 'user-uuid-2' }] }) // audience query
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValue(mockClient as any)
    vi.mocked(queryMany).mockResolvedValue(USERS as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.eligible).toHaveLength(2)
    expect(json.isCustom).toBe(true)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('returns error when custom SQL fails safety check', async () => {
    vi.mocked(getScenario).mockReturnValue(undefined as any)

    vi.mocked(queryOne).mockResolvedValue({
      kind: CAMPAIGN_KIND,
      generated_sql: 'DROP TABLE users',
      enabled: true,
    } as any)
    vi.mocked(validateScenarioSql).mockReturnValue({ ok: false, reason: 'DML not allowed' } as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.error).toMatch(/safety check/)
  })

  it('returns 500 when custom SQL query fails', async () => {
    vi.mocked(getScenario).mockReturnValue(undefined as any)
    vi.mocked(queryOne).mockResolvedValue({
      kind: CAMPAIGN_KIND,
      generated_sql: 'SELECT u.id FROM users u LIMIT $3',
      enabled: true,
    } as any)
    vi.mocked(validateScenarioSql).mockReturnValue({ ok: true, normalized: 'SELECT u.id FROM users u LIMIT $3' } as any)

    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // SET timeout
        .mockResolvedValueOnce(undefined) // SET lock
        .mockRejectedValueOnce(new Error('statement timeout')),
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValue(mockClient as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/statement timeout/)
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('includes disabled note for disabled custom scenario', async () => {
    vi.mocked(getScenario).mockReturnValue(undefined as any)
    vi.mocked(queryOne).mockResolvedValue({
      kind: CAMPAIGN_KIND,
      generated_sql: 'SELECT u.id FROM users u LIMIT $3',
      enabled: false,
      description: 'disabled one',
      ai_prompt: 'test',
    } as any)
    vi.mocked(validateScenarioSql).mockReturnValue({ ok: true, normalized: 'SELECT u.id FROM users u LIMIT $3' } as any)

    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValue(mockClient as any)
    vi.mocked(queryMany).mockResolvedValue([] as any)

    const res = await GET(makeReq(), { params: Promise.resolve({ kind: CAMPAIGN_KIND }) })
    const json = await res.json()

    expect(json.note).toMatch(/DISABLED/)
  })
})
