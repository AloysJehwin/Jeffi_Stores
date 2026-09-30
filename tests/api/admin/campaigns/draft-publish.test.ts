import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock auth
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn().mockReturnValue(true),
}))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockGetClient = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  getClient: (...a: any[]) => mockGetClient(...a),
  withTransaction: vi.fn(),
}))

const mockGetCampaign = vi.fn()
vi.mock('@/lib/shared/marketing', () => ({
  getCampaign: (...a: any[]) => mockGetCampaign(...a),
}))

const mockGetScenario = vi.fn()
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  getScenario: (...a: any[]) => mockGetScenario(...a),
}))

vi.mock('@/lib/campaigns/types', () => ({
  resolveParams: (defaults: any, params: any) => ({ ...defaults, ...params }),
}))

const mockValidateScenarioSql = vi.fn()
vi.mock('@/lib/campaigns/sql-safety', () => ({
  validateScenarioSql: (...a: any[]) => mockValidateScenarioSql(...a),
}))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { GET, PATCH, DELETE } from '@/app/api/(admin)/admin/campaigns/[kind]/draft/route'
import { POST as publishPost } from '@/app/api/(admin)/admin/campaigns/[kind]/publish/route'
import { GET as eligibleGet } from '@/app/api/(admin)/admin/campaigns/[kind]/eligible/route'

const mockAdmin = { id: 'admin-1', role: 'super_admin', scopes: [] }

function makeReq(method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost/api/admin/campaigns/abandoned_cart/draft`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = Promise.resolve({ kind: 'abandoned_cart' })

describe('campaigns draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(mockAdmin as any)
  })

  it('GET returns draft_fields null when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: null })
    const res = await GET(makeReq(), { params })
    const data = await res.json()
    expect(data.draft_fields).toBeNull()
  })

  it('GET returns draft_fields when draft exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: { title: 'test' } })
    const res = await GET(makeReq(), { params })
    const data = await res.json()
    expect(data.draft_fields).toEqual({ title: 'test' })
  })

  it('GET returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeReq(), { params })
    expect(res.status).toBe(401)
  })

  it('PATCH saves draft fields', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await PATCH(makeReq('PATCH', { enabled: true }), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE campaigns'), expect.any(Array))
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await DELETE(makeReq('DELETE'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('GET returns 403 when missing campaigns:read scope', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    const res = await GET(makeReq(), { params })
    expect(res.status).toBe(403)
  })

  it('GET returns 404 when campaign not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeReq(), { params })
    expect(res.status).toBe(404)
  })

  it('PATCH returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(makeReq('PATCH', { enabled: true }), { params })
    expect(res.status).toBe(401)
  })

  it('PATCH returns 403 when missing campaigns:write scope', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    const res = await PATCH(makeReq('PATCH', { enabled: true }), { params })
    expect(res.status).toBe(403)
  })

  it('DELETE returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE'), { params })
    expect(res.status).toBe(401)
  })

  it('DELETE returns 403 when missing campaigns:write scope', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    const res = await DELETE(makeReq('DELETE'), { params })
    expect(res.status).toBe(403)
  })
})

describe('campaigns publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(mockAdmin as any)
  })

  it('returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when campaign has no draft_fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: null })
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(400)
  })

  it('publishes draft when draft_fields exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ draft_fields: { enabled: true, subject_template: 'test' } })
    mockQuery.mockResolvedValueOnce({})
    const res = await publishPost(makeReq('POST'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE campaigns'), expect.any(Array))
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing campaigns:write scope', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    const res = await publishPost(makeReq('POST'), { params })
    expect(res.status).toBe(403)
  })

  it('publishes with fully populated draft_fields (all COALESCE branches)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      draft_fields: {
        enabled: false,
        delay_hours: 24,
        discount_percent: 10,
        coupon_id: 'coupon-123',
        scenario_kind: 'custom',
        subject_template: 'Subject',
        body_template: 'Body',
        parameters: { foo: 'bar' },
      },
    })
    mockQuery.mockResolvedValueOnce({})
    const res = await publishPost(makeReq('POST'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    const callArgs = mockQuery.mock.calls[0][1]
    expect(callArgs[1]).toBe(false)
    expect(callArgs[2]).toBe(24)
    expect(callArgs[3]).toBe(10)
    expect(callArgs[4]).toBe('coupon-123')
    expect(callArgs[8]).toBe(JSON.stringify({ foo: 'bar' }))
  })

  it('publishes with null/omitted draft fields (COALESCE null branches)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      draft_fields: { enabled: null, delay_hours: null, discount_percent: null },
    })
    mockQuery.mockResolvedValueOnce({})
    const res = await publishPost(makeReq('POST'), { params })
    const data = await res.json()
    expect(data.success).toBe(true)
    const callArgs = mockQuery.mock.calls[0][1]
    expect(callArgs[1]).toBeNull()
    expect(callArgs[2]).toBeNull()
    expect(callArgs[3]).toBeNull()
    expect(callArgs[8]).toBeNull()
  })
})

describe('campaigns eligible route', () => {
  const eligibleReq = () =>
    new NextRequest('http://localhost/api/admin/campaigns/abandoned_cart/eligible', { method: 'GET' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(mockAdmin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await eligibleGet(eligibleReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing mailer:read scope', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    const res = await eligibleGet(eligibleReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when campaign not found', async () => {
    mockGetCampaign.mockResolvedValueOnce(null)
    const res = await eligibleGet(eligibleReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns note when no scenario module registered', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart' })
    mockGetScenario.mockReturnValueOnce(undefined)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.total).toBe(0)
    expect(data.note).toContain('No automation scenario')
  })

  it('builtin: returns empty result when no eligible or suppressed', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: {} })
    mockGetScenario.mockReturnValueOnce({
      defaultParams: {},
      trigger: 'trig',
      description: 'desc',
      paramSchema: {},
      findEligible: vi.fn().mockResolvedValue([]),
    })
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.total).toBe(0)
    expect(data.eligible).toEqual([])
  })

  it('builtin: returns 500 when findEligible throws', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: {} })
    mockGetScenario.mockReturnValueOnce({
      defaultParams: {},
      findEligible: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const res = await eligibleGet(eligibleReq(), { params })
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('boom')
  })

  it('builtin: maps eligible rows and resolves users', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', scenario_kind: 'sc1', parameters: {} })
    mockGetScenario.mockReturnValueOnce({
      defaultParams: {},
      trigger: 'trig',
      description: 'desc',
      paramSchema: {},
      findEligible: vi.fn().mockResolvedValue([{ user_id: 'u1', product_id: 'p1' }]),
      findSuppressed: vi.fn().mockResolvedValue([{ user_id: 'u2', reason: 'cooldown' }]),
    })
    mockQueryMany.mockResolvedValueOnce([
      { id: 'u1', email: 'a@b.com', first_name: 'A', last_name: 'B', marketing_opt_out: false },
    ])
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.total).toBe(1)
    expect(data.eligible[0].user_email).toBe('a@b.com')
    expect(data.eligible[0].user_name).toBe('A B')
    expect(data.suppressedTotal).toBe(1)
  })

  it('builtin: findSuppressed error is swallowed', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: {} })
    mockGetScenario.mockReturnValueOnce({
      defaultParams: {},
      trigger: 'trig',
      description: 'desc',
      paramSchema: {},
      findEligible: vi.fn().mockResolvedValue([{ id: 'row1' }]),
      findSuppressed: vi.fn().mockRejectedValue(new Error('sup fail')),
    })
    mockQueryMany.mockResolvedValueOnce([])
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.total).toBe(1)
    expect(data.suppressed).toEqual([])
  })

  it('custom: returns error when SQL fails safety check', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: {} })
    mockGetScenario.mockReturnValueOnce(undefined)
    mockQueryOne.mockResolvedValueOnce({
      kind: 'abandoned_cart',
      generated_sql: 'SELECT',
      product_sql: null,
      enabled: true,
      description: null,
      ai_prompt: null,
    })
    mockValidateScenarioSql.mockReturnValueOnce({ ok: false, reason: 'unsafe' })
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.error).toContain('safety check')
  })

  it('custom: runs preview query and maps users', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: { sendCooldownDays: 3 } })
    mockGetScenario.mockReturnValueOnce(undefined)
    mockQueryOne.mockResolvedValueOnce({
      kind: 'abandoned_cart',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: false,
      description: 'd',
      ai_prompt: 'prompt',
    })
    mockValidateScenarioSql.mockReturnValueOnce({ ok: true, normalized: 'SELECT id FROM users' })
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // statement_timeout
        .mockResolvedValueOnce({}) // lock_timeout
        .mockResolvedValueOnce({ rows: [{ id: 'u1' }] }) // main query
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client)
    mockQueryMany.mockResolvedValueOnce([
      { id: 'u1', email: 'x@y.com', first_name: 'X', last_name: 'Y', marketing_opt_out: true },
    ])
    const res = await eligibleGet(eligibleReq(), { params })
    const data = await res.json()
    expect(data.total).toBe(1)
    expect(data.isCustom).toBe(true)
    expect(data.note).toContain('DISABLED')
    expect(client.release).toHaveBeenCalled()
  })

  it('custom: returns 500 when preview query throws', async () => {
    mockGetCampaign.mockResolvedValueOnce({ kind: 'abandoned_cart', parameters: {} })
    mockGetScenario.mockReturnValueOnce(undefined)
    mockQueryOne.mockResolvedValueOnce({
      kind: 'abandoned_cart',
      generated_sql: 'SELECT id',
      product_sql: null,
      enabled: true,
      description: null,
      ai_prompt: null,
    })
    mockValidateScenarioSql.mockReturnValueOnce({ ok: true, normalized: 'SELECT id' })
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // statement_timeout
        .mockResolvedValueOnce({}) // lock_timeout
        .mockRejectedValueOnce(new Error('query boom')) // main query throws
        .mockResolvedValueOnce({}), // ROLLBACK in catch
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client)
    const res = await eligibleGet(eligibleReq(), { params })
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('query boom')
    expect(client.release).toHaveBeenCalled()
  })
})
