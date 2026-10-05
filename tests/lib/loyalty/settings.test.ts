import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))

import {
  getLoyaltySettings,
  LOYALTY_DEFAULTS,
  LoyaltySettingsInputSchema,
  markLoyaltyLaunched,
  saveLoyaltySettings,
} from '@/lib/loyalty/settings'
import { query, queryMany } from '@/lib/shared/db'

const mockQuery = query as ReturnType<typeof vi.fn>
const mockQueryMany = queryMany as ReturnType<typeof vi.fn>

const validInput = {
  enabled: true,
  rupeesPerPoint: 100,
  pointValue: 1,
  creditDelayDays: 7,
  minRedeemPoints: 100,
  countFrom: null,
  tiers: [
    { key: 'silver' as const, minPoints: 100, multiplier: 1.25 },
    { key: 'gold' as const, minPoints: 500, multiplier: 1.5 },
    { key: 'platinum' as const, minPoints: 1500, multiplier: 2 },
  ],
}

function stored(values: Record<string, string>) {
  mockQueryMany.mockResolvedValue(Object.entries(values).map(([key, value]) => ({ key, value })))
}

describe('loyalty settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  describe('getLoyaltySettings', () => {
    it('is off with the documented defaults when nothing is stored', async () => {
      stored({})
      const settings = await getLoyaltySettings()
      expect(settings.enabled).toBe(false)
      expect(settings.rupeesPerPoint).toBe(100)
      expect(settings.pointValue).toBe(1)
      expect(settings.creditDelayDays).toBe(7)
      expect(settings.minRedeemPoints).toBe(100)
      expect(settings.tiers.map(tier => [tier.key, tier.minPoints, tier.multiplier])).toEqual([
        ['bronze', 0, 1],
        ['silver', 100, 1.25],
        ['gold', 500, 1.5],
        ['platinum', 1500, 2],
      ])
      expect(settings.countFrom).toBeNull()
      expect(settings.launchedAt).toBeNull()
    })

    it('reads stored values', async () => {
      stored({
        loyalty_enabled: 'true',
        loyalty_rupees_per_point: '50',
        loyalty_point_value: '0.5',
        loyalty_credit_delay_days: '0',
        loyalty_min_redeem_points: '200',
        loyalty_count_from: '2026-01-01',
        loyalty_launched_at: '2026-10-05T10:00:00.000Z',
        loyalty_tiers: JSON.stringify([
          { key: 'silver', minPoints: 10, multiplier: 1 },
          { key: 'gold', minPoints: 20, multiplier: 1 },
          { key: 'platinum', minPoints: 30, multiplier: 3 },
        ]),
      })
      const settings = await getLoyaltySettings()
      expect(settings).toMatchObject({
        enabled: true,
        rupeesPerPoint: 50,
        pointValue: 0.5,
        creditDelayDays: 0,
        minRedeemPoints: 200,
        countFrom: '2026-01-01',
        launchedAt: '2026-10-05T10:00:00.000Z',
      })
      expect(settings.tiers[3]).toMatchObject({ key: 'platinum', name: 'Platinum', minPoints: 30, multiplier: 3 })
    })

    it('falls back field by field when a stored value is unusable', async () => {
      stored({
        loyalty_enabled: 'yes',
        loyalty_rupees_per_point: '0',
        loyalty_point_value: 'abc',
        loyalty_credit_delay_days: '2.5',
        loyalty_min_redeem_points: '-4',
        loyalty_count_from: '2026-02-30',
        loyalty_tiers: '[{"key":"gold","minPoints":5,"multiplier":1}]',
      })
      const settings = await getLoyaltySettings()
      expect(settings.enabled).toBe(false)
      expect(settings.rupeesPerPoint).toBe(100)
      expect(settings.pointValue).toBe(1)
      expect(settings.creditDelayDays).toBe(7)
      expect(settings.minRedeemPoints).toBe(100)
      expect(settings.countFrom).toBeNull()
      expect(settings.tiers).toEqual(LOYALTY_DEFAULTS.tiers)
    })

    it('stays off when the settings cannot be read', async () => {
      mockQueryMany.mockRejectedValue(new Error('relation missing'))
      expect(await getLoyaltySettings()).toEqual(LOYALTY_DEFAULTS)
    })
  })

  describe('saveLoyaltySettings', () => {
    it('writes every key in one upsert and never the launch stamp', async () => {
      await saveLoyaltySettings({ ...validInput, pointValue: 0.333, countFrom: '2026-03-01' })
      expect(mockQuery).toHaveBeenCalledTimes(1)
      const [sql, [keys, values]] = mockQuery.mock.calls[0]
      expect(String(sql)).toContain('ON CONFLICT (key) DO UPDATE')
      expect(keys).not.toContain('loyalty_launched_at')
      const saved = Object.fromEntries((keys as string[]).map((key, i) => [key, (values as string[])[i]]))
      expect(saved.loyalty_enabled).toBe('true')
      expect(saved.loyalty_point_value).toBe('0.33')
      expect(saved.loyalty_count_from).toBe('2026-03-01')
      expect(JSON.parse(saved.loyalty_tiers)).toHaveLength(3)
    })

    it('stores an empty count-from date as blank', async () => {
      await saveLoyaltySettings(validInput)
      const [, [keys, values]] = mockQuery.mock.calls[0]
      expect((values as string[])[(keys as string[]).indexOf('loyalty_count_from')]).toBe('')
    })
  })

  describe('markLoyaltyLaunched', () => {
    it('stamps the launch time only when it is still empty', async () => {
      await markLoyaltyLaunched()
      const [sql, args] = mockQuery.mock.calls[0]
      expect(String(sql)).toContain("COALESCE(site_settings.value, '') = ''")
      expect(args[0]).toBe('loyalty_launched_at')
      expect(Number.isNaN(Date.parse(args[1]))).toBe(false)
    })
  })

  describe('LoyaltySettingsInputSchema', () => {
    it('accepts a valid form', () => {
      expect(LoyaltySettingsInputSchema.safeParse(validInput).success).toBe(true)
    })

    it('rejects tiers that are out of order or do not climb', () => {
      const swapped = { ...validInput, tiers: [validInput.tiers[1], validInput.tiers[0], validInput.tiers[2]] }
      expect(LoyaltySettingsInputSchema.safeParse(swapped).success).toBe(false)
      const flat = {
        ...validInput,
        tiers: [validInput.tiers[0], { ...validInput.tiers[1], minPoints: 100 }, validInput.tiers[2]],
      }
      expect(LoyaltySettingsInputSchema.safeParse(flat).success).toBe(false)
    })

    it('rejects out-of-range numbers and impossible dates', () => {
      expect(LoyaltySettingsInputSchema.safeParse({ ...validInput, rupeesPerPoint: 0 }).success).toBe(false)
      expect(LoyaltySettingsInputSchema.safeParse({ ...validInput, pointValue: 0 }).success).toBe(false)
      expect(LoyaltySettingsInputSchema.safeParse({ ...validInput, creditDelayDays: 91 }).success).toBe(false)
      expect(LoyaltySettingsInputSchema.safeParse({ ...validInput, countFrom: '2026-13-01' }).success).toBe(false)
      const slow = { ...validInput, tiers: [{ ...validInput.tiers[0], multiplier: 0.5 }, ...validInput.tiers.slice(1)] }
      expect(LoyaltySettingsInputSchema.safeParse(slow).success).toBe(false)
    })
  })
})
