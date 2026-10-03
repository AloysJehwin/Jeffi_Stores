import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  listScenarios: vi.fn(),
}))

import { ensureBuiltinCampaignRows } from '@/lib/campaigns/ensure-builtin-campaigns'
import { query } from '@/lib/shared/db'
import { listScenarios } from '@/lib/campaigns/scenarios/_registry'

const mockQuery = query as ReturnType<typeof vi.fn>
const mockList = listScenarios as ReturnType<typeof vi.fn>

describe('ensureBuiltinCampaignRows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is a no-op when there are no scenarios', async () => {
    mockList.mockReturnValue([])
    await ensureBuiltinCampaignRows()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('upserts scenarios BEFORE campaigns (FK order) with ON CONFLICT DO NOTHING', async () => {
    mockList.mockReturnValue([
      { kind: 'viewed_product', name: 'Viewed Product', description: 'd', defaultParams: { lookback: 1 } },
    ])
    await ensureBuiltinCampaignRows()
    expect(mockQuery).toHaveBeenCalledTimes(2)
    const [scenSql] = mockQuery.mock.calls[0]
    const [campSql] = mockQuery.mock.calls[1]
    expect(scenSql).toMatch(/INSERT INTO scenarios/)
    expect(scenSql).toMatch(/ON CONFLICT \(kind\) DO NOTHING/)
    expect(campSql).toMatch(/INSERT INTO campaigns/)
    expect(campSql).toMatch(/ON CONFLICT \(kind\) DO NOTHING/)
  })

  it('seeds the campaign row disabled, with scenario_kind = kind', async () => {
    mockList.mockReturnValue([{ kind: 'birthday', name: 'Birthday', description: 'd', defaultParams: {} }])
    await ensureBuiltinCampaignRows()
    const [campSql, campParams] = mockQuery.mock.calls[1]
    // enabled column is the literal false in the VALUES tuple
    expect(campSql).toMatch(/enabled\)/)
    expect(campSql).toMatch(/false\)/)
    // params carry kind twice (kind + scenario_kind) + name + description + subject + body
    expect(campParams).toContain('birthday')
  })

  it('swallows DB errors (never throws into the request path)', async () => {
    mockList.mockReturnValue([{ kind: 'x', name: 'X', description: '', defaultParams: {} }])
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(ensureBuiltinCampaignRows()).resolves.toBeUndefined()
  })
})
