import { z } from 'zod'
import { query, queryMany } from '@/lib/shared/db'
import { BASE_TIER, TIER_NAMES, type LoyaltyTier } from './tiers'

export interface LoyaltySettings {
  enabled: boolean
  rupeesPerPoint: number
  pointValue: number
  creditDelayDays: number
  minRedeemPoints: number
  tiers: LoyaltyTier[]
  countFrom: string | null
  launchedAt: string | null
}

const UPPER_KEYS = ['silver', 'gold', 'platinum'] as const

const UpperTierSchema = z.object({
  key: z.enum(UPPER_KEYS),
  minPoints: z.number().int().min(1).max(10_000_000),
  multiplier: z.number().min(1).max(10),
})

const UpperTiersSchema = z
  .array(UpperTierSchema)
  .length(UPPER_KEYS.length)
  .refine(tiers => tiers.every((tier, i) => tier.key === UPPER_KEYS[i]), 'Tiers must be Silver, Gold, Platinum in order')
  .refine(
    tiers => tiers.every((tier, i) => i === 0 || tier.minPoints > tiers[i - 1].minPoints),
    'Each tier must need more points than the one before it'
  )

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const LoyaltySettingsInputSchema = z.object({
  enabled: z.boolean(),
  rupeesPerPoint: z.number().int().min(1).max(100_000),
  pointValue: z.number().min(0.01).max(1000),
  creditDelayDays: z.number().int().min(0).max(90),
  minRedeemPoints: z.number().int().min(1).max(1_000_000),
  tiers: UpperTiersSchema,
  countFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine(isRealDate, 'Not a real date')
    .nullable(),
})

export type LoyaltySettingsInput = z.infer<typeof LoyaltySettingsInputSchema>

// What the CRM settings form edits. On/off lives in Site Controls, so a stale form can't flip it.
export const LoyaltySettingsFormSchema = LoyaltySettingsInputSchema.omit({ enabled: true })

const KEY = {
  enabled: 'loyalty_enabled',
  rupeesPerPoint: 'loyalty_rupees_per_point',
  pointValue: 'loyalty_point_value',
  creditDelayDays: 'loyalty_credit_delay_days',
  minRedeemPoints: 'loyalty_min_redeem_points',
  tiers: 'loyalty_tiers',
  countFrom: 'loyalty_count_from',
  launchedAt: 'loyalty_launched_at',
} as const

const DEFAULT_UPPER_TIERS: LoyaltySettingsInput['tiers'] = [
  { key: 'silver', minPoints: 100, multiplier: 1.25 },
  { key: 'gold', minPoints: 500, multiplier: 1.5 },
  { key: 'platinum', minPoints: 1500, multiplier: 2 },
]

function withBaseTier(upper: LoyaltySettingsInput['tiers']): LoyaltyTier[] {
  return [BASE_TIER, ...upper.map(tier => ({ ...tier, name: TIER_NAMES[tier.key] }))]
}

export const LOYALTY_DEFAULTS: LoyaltySettings = {
  enabled: false,
  rupeesPerPoint: 100,
  pointValue: 1,
  creditDelayDays: 7,
  minRedeemPoints: 100,
  tiers: withBaseTier(DEFAULT_UPPER_TIERS),
  countFrom: null,
  launchedAt: null,
}

function boundedNumber(raw: string | null | undefined, fallback: number, min: number, max: number, integer: boolean) {
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) return fallback
  if (integer && !Number.isInteger(value)) return fallback
  return value
}

function parseTiers(raw: string | null | undefined): LoyaltyTier[] {
  if (!raw) return LOYALTY_DEFAULTS.tiers
  try {
    const parsed = UpperTiersSchema.safeParse(JSON.parse(raw))
    return parsed.success ? withBaseTier(parsed.data) : LOYALTY_DEFAULTS.tiers
  } catch {
    return LOYALTY_DEFAULTS.tiers
  }
}

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  let rows: { key: string; value: string | null }[]
  try {
    rows = await queryMany<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
      [Object.values(KEY)]
    )
  } catch {
    return LOYALTY_DEFAULTS
  }
  const stored = new Map(rows.map(row => [row.key, row.value]))
  const countFrom = stored.get(KEY.countFrom) || null
  const d = LOYALTY_DEFAULTS
  return {
    enabled: (stored.get(KEY.enabled) ?? '').toLowerCase() === 'true',
    rupeesPerPoint: boundedNumber(stored.get(KEY.rupeesPerPoint), d.rupeesPerPoint, 1, 100_000, true),
    pointValue: boundedNumber(stored.get(KEY.pointValue), d.pointValue, 0.01, 1000, false),
    creditDelayDays: boundedNumber(stored.get(KEY.creditDelayDays), d.creditDelayDays, 0, 90, true),
    minRedeemPoints: boundedNumber(stored.get(KEY.minRedeemPoints), d.minRedeemPoints, 1, 1_000_000, true),
    tiers: parseTiers(stored.get(KEY.tiers)),
    countFrom: countFrom && /^\d{4}-\d{2}-\d{2}$/.test(countFrom) && isRealDate(countFrom) ? countFrom : null,
    launchedAt: stored.get(KEY.launchedAt) || null,
  }
}

export async function saveLoyaltySettings(input: LoyaltySettingsInput): Promise<void> {
  const values: Record<string, string> = {
    [KEY.enabled]: String(input.enabled),
    [KEY.rupeesPerPoint]: String(input.rupeesPerPoint),
    [KEY.pointValue]: String(Math.round(input.pointValue * 100) / 100),
    [KEY.creditDelayDays]: String(input.creditDelayDays),
    [KEY.minRedeemPoints]: String(input.minRedeemPoints),
    [KEY.tiers]: JSON.stringify(input.tiers),
    [KEY.countFrom]: input.countFrom ?? '',
  }
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     SELECT k, v, NOW() FROM UNNEST($1::text[], $2::text[]) AS t(k, v)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [Object.keys(values), Object.values(values)]
  )
}

export async function markLoyaltyLaunched(): Promise<void> {
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE COALESCE(site_settings.value, '') = ''`,
    [KEY.launchedAt, new Date().toISOString()]
  )
}
