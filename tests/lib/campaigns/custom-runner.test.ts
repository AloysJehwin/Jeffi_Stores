import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  getClient: vi.fn(),
}))

vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))

vi.mock('@/lib/campaigns/sql-safety', () => ({
  validateScenarioSql: vi.fn(),
}))

import { isCustomScenario, runCustomScenario } from '@/lib/campaigns/custom-runner'
import { queryOne, getClient } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const mockGetClient = getClient as ReturnType<typeof vi.fn>
const mockFetchUserContext = fetchUserContext as ReturnType<typeof vi.fn>
const mockResolveCoupon = resolveCoupon as ReturnType<typeof vi.fn>
const mockSendCampaignEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockValidateSql = validateScenarioSql as ReturnType<typeof vi.fn>

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'custom_test',
    enabled: true,
    name: 'Custom Test',
    coupon_id: null,
    discount_percent: 0,
    delay_hours: 0,
    parameters: {},
    ...overrides,
  } as any
}

function makeDbClient(queryResults: any[] = []) {
  let callCount = 0
  return {
    query: vi.fn().mockImplementation(() => {
      const result = queryResults[callCount++] ?? { rows: [] }
      return Promise.resolve(result)
    }),
    release: vi.fn(),
  }
}

describe('isCustomScenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when row exists and enabled', async () => {
    mockQueryOne.mockResolvedValue({ enabled: true })
    const result = await isCustomScenario('my_scenario')
    expect(result).toBe(true)
  })

  it('returns false when row exists but disabled', async () => {
    mockQueryOne.mockResolvedValue({ enabled: false })
    const result = await isCustomScenario('my_scenario')
    expect(result).toBe(false)
  })

  it('returns false when row not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await isCustomScenario('missing_scenario')
    expect(result).toBe(false)
  })
})

describe('runCustomScenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result when custom scenario row not found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result).toMatchObject({ attempted: 0, sent: 0, skipped: 0 })
  })

  it('returns empty result when scenario disabled', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: false,
    })
    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.attempted).toBe(0)
  })

  it('returns empty result when SQL validation fails', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'DROP TABLE users',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: false, error: 'Dangerous SQL' })
    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.attempted).toBe(0)
  })

  it('sends emails to eligible users', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users LIMIT $3',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: true, normalized: 'SELECT id FROM users LIMIT $3' })

    const client = makeDbClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SET statement_timeout
      { rows: [] }, // SET lock_timeout
      { rows: [{ id: 'user-1' }, { id: 'user-2' }] }, // audience query
      { rows: [] }, // ROLLBACK
    ])
    mockGetClient.mockResolvedValue(client)

    mockFetchUserContext.mockResolvedValue({ id: 'user-1', first_name: 'Alice', email: 'a@x.com' })
    mockResolveCoupon.mockResolvedValue({ couponCode: 'SAVE10', discountPercent: 10 })
    mockSendCampaignEmail.mockResolvedValue({ ok: true })

    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.attempted).toBe(2)
    expect(result.sent).toBe(2)
  })

  it('increments skipped when user not found', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: true, normalized: 'SELECT id FROM users' })

    const client = makeDbClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'ghost-user' }] },
      { rows: [] },
    ])
    mockGetClient.mockResolvedValue(client)
    mockFetchUserContext.mockResolvedValue(null)

    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.skipped).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('increments skipped when sendCampaignEmail returns ok=false', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: true, normalized: 'SELECT id FROM users' })

    const client = makeDbClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ id: 'u1' }] }, { rows: [] }])
    mockGetClient.mockResolvedValue(client)
    mockFetchUserContext.mockResolvedValue({ id: 'u1', first_name: 'Bob', email: 'b@x.com' })
    mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
    mockSendCampaignEmail.mockResolvedValue({ ok: false, reason: 'ses_error' })

    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.skipped).toBe(1)
  })

  it('returns empty result when DB query throws', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: true, normalized: 'SELECT id FROM users' })

    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [] }) // SET lock_timeout
        .mockRejectedValueOnce(new Error('query failed')), // audience query throws
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client)

    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.attempted).toBe(0)
    expect(client.release).toHaveBeenCalled()
  })

  it('uses maxRecipientsPerSweep and sendCooldownDays from campaign parameters', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: null,
      enabled: true,
    })
    mockValidateSql.mockReturnValue({ ok: true, normalized: 'SELECT id FROM users' })

    const client = makeDbClient([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }])
    mockGetClient.mockResolvedValue(client)

    const campaign = makeCampaign({ parameters: { sendCooldownDays: 14, maxRecipientsPerSweep: 100 } })
    await runCustomScenario('my_scenario', campaign)

    const callArgs = client.query.mock.calls[3]
    expect(callArgs[1]).toContain(14)
    expect(callArgs[1]).toContain(100)
  })

  it('handles valid product_sql alongside audience SQL', async () => {
    mockQueryOne.mockResolvedValue({
      kind: 'my_scenario',
      generated_sql: 'SELECT id FROM users',
      product_sql: 'SELECT product_id, name, slug, image_url, price FROM products',
      enabled: true,
    })
    mockValidateSql
      .mockReturnValueOnce({ ok: true, normalized: 'SELECT id FROM users' })
      .mockReturnValueOnce({ ok: true, normalized: 'SELECT product_id, name, slug, image_url, price FROM products' })

    const client = makeDbClient([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] }, // audience
      { rows: [{ product_id: 'p1', name: 'Bolt', slug: 'bolt', image_url: null, price: 10 }] }, // products
      { rows: [] }, // ROLLBACK
    ])
    mockGetClient.mockResolvedValue(client)

    const result = await runCustomScenario('my_scenario', makeCampaign())
    expect(result.attempted).toBe(0)
  })
})
