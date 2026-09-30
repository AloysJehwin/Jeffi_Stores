import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/shared/marketing', () => ({
  getCampaign: vi.fn(),
}))

import { runScenario, runScenarioForAllCampaigns } from '@/lib/campaigns/runner'
import { query } from '@/lib/shared/db'
import { getCampaign } from '@/lib/shared/marketing'

const mockQuery = query as ReturnType<typeof vi.fn>
const mockGetCampaign = getCampaign as ReturnType<typeof vi.fn>

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'abandoned_checkout',
    enabled: true,
    name: 'Test Campaign',
    coupon_id: null,
    discount_percent: 0,
    delay_hours: 1,
    parameters: {},
    ...overrides,
  }
}

function makeScenario(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'abandoned_checkout',
    name: 'Test Scenario',
    description: 'desc',
    trigger: 'trigger',
    defaultParams: { sendCooldownDays: 1 },
    paramSchema: {},
    findEligible: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as any
}

describe('runScenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('returns zero counts when campaign not found', async () => {
    mockGetCampaign.mockResolvedValue(null)
    const result = await runScenario(makeScenario(), 'abandoned_checkout')
    expect(result).toEqual({ campaign: 'abandoned_checkout', attempted: 0, sent: 0, skipped: 0 })
    expect(makeScenario().findEligible).not.toHaveBeenCalled()
  })

  it('returns zero counts when campaign disabled', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign({ enabled: false }))
    const scenario = makeScenario()
    const result = await runScenario(scenario, 'abandoned_checkout')
    expect(result.attempted).toBe(0)
    expect(scenario.findEligible).not.toHaveBeenCalled()
  })

  it('returns zero when no eligible rows', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign())
    const scenario = makeScenario({ findEligible: vi.fn().mockResolvedValue([]) })
    const result = await runScenario(scenario, 'abandoned_checkout')
    expect(result).toEqual({ campaign: 'abandoned_checkout', attempted: 0, sent: 0, skipped: 0 })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('counts sent and skipped correctly', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign())
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]
    const sendFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'no_user' })
      .mockResolvedValueOnce({ ok: true })
    const scenario = makeScenario({ findEligible: vi.fn().mockResolvedValue(rows), send: sendFn })
    const result = await runScenario(scenario, 'abandoned_checkout')
    expect(result.attempted).toBe(3)
    expect(result.sent).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('updates last_run_at when rows were attempted', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign())
    const scenario = makeScenario({ findEligible: vi.fn().mockResolvedValue([{ id: '1' }]) })
    await runScenario(scenario, 'abandoned_checkout')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE campaigns SET last_run_at'), [
      'abandoned_checkout',
    ])
  })

  it('does not update last_run_at when no rows attempted', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign())
    const scenario = makeScenario()
    await runScenario(scenario, 'abandoned_checkout')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('does not throw when last_run_at UPDATE fails', async () => {
    mockGetCampaign.mockResolvedValue(makeCampaign())
    const scenario = makeScenario({ findEligible: vi.fn().mockResolvedValue([{ id: '1' }]) })
    mockQuery.mockRejectedValue(new Error('DB error'))
    await expect(runScenario(scenario, 'abandoned_checkout')).resolves.toBeDefined()
  })

  it('merges campaign parameters over defaults', async () => {
    const campaign = makeCampaign({ parameters: { sendCooldownDays: 30 } })
    mockGetCampaign.mockResolvedValue(campaign)
    const findEligible = vi.fn().mockResolvedValue([])
    const scenario = makeScenario({ findEligible })
    await runScenario(scenario, 'abandoned_checkout')
    const ctx = findEligible.mock.calls[0][0]
    expect(ctx.params.sendCooldownDays).toBe(30)
  })
})

describe('runScenarioForAllCampaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCampaign.mockResolvedValue(makeCampaign())
  })

  it('returns empty array when no campaigns found', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    const scenario = makeScenario()
    const result = await runScenarioForAllCampaigns(scenario)
    expect(result).toEqual([])
  })

  it('runs scenario for each enabled campaign kind', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ kind: 'abandoned_checkout' }, { kind: 'winback_90' }] })
      .mockResolvedValue({ rows: [] })

    const scenario = makeScenario({ kind: 'abandoned_checkout', findEligible: vi.fn().mockResolvedValue([]) })
    const result = await runScenarioForAllCampaigns(scenario)
    expect(result).toHaveLength(2)
    expect(result[0].campaign).toBe('abandoned_checkout')
    expect(result[1].campaign).toBe('winback_90')
  })

  it('queries campaigns by scenario_kind', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    const scenario = makeScenario({ kind: 'winback_90' })
    await runScenarioForAllCampaigns(scenario)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('scenario_kind = $1'), ['winback_90'])
  })
})
