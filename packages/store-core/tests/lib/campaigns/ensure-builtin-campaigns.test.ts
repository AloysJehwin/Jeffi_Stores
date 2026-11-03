import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/campaigns/scenarios/_registry', () => ({
  listScenarios: vi.fn(),
}))
// Keep this a pure test of the seeder's SQL shape — not coupled to template content.
vi.mock('@/lib/campaigns/template-validation', () => ({
  validateCampaignBodyTemplate: vi.fn().mockReturnValue({ ok: true }),
}))

import { ensureBuiltinCampaignRows } from '@/lib/campaigns/ensure-builtin-campaigns'
import { query } from '@/lib/shared/db'
import { listScenarios } from '@/lib/campaigns/scenarios/_registry'
import { RETIRED_BUILTIN_TEMPLATES, getBuiltinTemplate } from '@/lib/campaigns/default-templates'

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
    expect(campSql).toMatch(/enabled, email_template_slug, sms_template_slug\)/)
    expect(campSql).toMatch(/false, \$\d+, \$\d+\)/)
    // params carry kind twice (kind + scenario_kind) + name + description + subject + body
    expect(campParams).toContain('birthday')
    // linked to its library templates from the start
    expect(campParams).toContain('campaign/birthday')
  })

  it('seeds new coupon-kind rows with the kind default discount, others with 0', async () => {
    mockList.mockReturnValue([
      { kind: 'birthday', name: 'Birthday', description: 'd', defaultParams: {} },
      { kind: 'viewed_product', name: 'Viewed', description: 'd', defaultParams: {} },
    ])
    await ensureBuiltinCampaignRows()
    const [campSql, campParams] = mockQuery.mock.calls[1]
    expect(campSql).toContain('discount_percent, enabled, email_template_slug, sms_template_slug)')
    expect(campSql).toMatch(/ON CONFLICT \(kind\) DO NOTHING/)
    // Each tuple is 9 params: kind, name, description, scenario_kind, subject, body, discount_percent, email + sms slug.
    expect((campParams as unknown[])[6]).toBe(15)
    expect((campParams as unknown[])[15]).toBe(0)
  })

  it('swallows DB errors (never throws into the request path)', async () => {
    mockList.mockReturnValue([{ kind: 'x', name: 'X', description: '', defaultParams: {} }])
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(ensureBuiltinCampaignRows()).resolves.toBeUndefined()
  })

  it('moves a row still on a retired default onto the current one, matching subject and body exactly', async () => {
    mockList.mockReturnValue([{ kind: 'referral_invite', name: 'Referral', description: 'd', defaultParams: {} }])
    await ensureBuiltinCampaignRows()
    const upgrade = mockQuery.mock.calls.find(
      c => String(c[0]).startsWith('UPDATE campaigns') && (c[1] as unknown[])?.[0] === 'referral_invite'
    )!
    expect(String(upgrade[0])).toContain('WHERE kind = $1 AND subject_template = $4 AND body_template = $5')
    const old = RETIRED_BUILTIN_TEMPLATES.referral_invite[0]
    const current = getBuiltinTemplate('referral_invite')!
    expect(upgrade[1]).toEqual(['referral_invite', current.subject, current.body, old.subject, old.body])
    // The retired copy is the one that promised a shared coupon.
    expect(old.subject).toContain('you both')
    expect(current.subject).not.toContain('you both')
  })

  it("moves winback_180's saved health cut off the retired 25, and only that exact value", async () => {
    mockList.mockReturnValue([
      { kind: 'winback_180', name: 'Win-back', description: 'd', defaultParams: { healthScoreMax: 100 } },
    ])
    await ensureBuiltinCampaignRows()
    const upgrade = mockQuery.mock.calls.find(c => String(c[0]).includes('jsonb_set(parameters'))!
    expect(String(upgrade[0])).toContain('(parameters->>$2)::numeric = $4')
    expect(upgrade[1]).toEqual(['winback_180', 'healthScoreMax', 100, 25])
  })
})
