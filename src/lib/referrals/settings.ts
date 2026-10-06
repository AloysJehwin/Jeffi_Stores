import { z } from 'zod'
import { query, queryMany } from '@/lib/shared/db'
import { getLoyaltySettings } from '@/lib/loyalty/settings'

export interface ReferralSettings {
  enabled: boolean
  rewardPoints: number
  yearlyCap: number
  qualifyDays: number
}

export const ReferralSettingsInputSchema = z.object({
  enabled: z.boolean(),
  rewardPoints: z.number().int().min(1).max(100_000),
  yearlyCap: z.number().int().min(1).max(1000),
  qualifyDays: z.number().int().min(1).max(365),
})

export type ReferralSettingsInput = z.infer<typeof ReferralSettingsInputSchema>

const KEY = {
  enabled: 'referral_enabled',
  rewardPoints: 'referral_reward_points',
  yearlyCap: 'referral_yearly_cap',
  qualifyDays: 'referral_qualify_days',
} as const

export const REFERRAL_DEFAULTS: ReferralSettings = {
  enabled: false,
  rewardPoints: 100,
  yearlyCap: 10,
  qualifyDays: 90,
}

function boundedInt(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export async function getReferralSettings(): Promise<ReferralSettings> {
  let rows: { key: string; value: string | null }[]
  try {
    rows = await queryMany<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
      [Object.values(KEY)]
    )
  } catch {
    return REFERRAL_DEFAULTS
  }
  const stored = new Map(rows.map(row => [row.key, row.value]))
  const d = REFERRAL_DEFAULTS
  return {
    enabled: (stored.get(KEY.enabled) ?? '').toLowerCase() === 'true',
    rewardPoints: boundedInt(stored.get(KEY.rewardPoints), d.rewardPoints, 1, 100_000),
    yearlyCap: boundedInt(stored.get(KEY.yearlyCap), d.yearlyCap, 1, 1000),
    qualifyDays: boundedInt(stored.get(KEY.qualifyDays), d.qualifyDays, 1, 365),
  }
}

export async function saveReferralSettings(input: ReferralSettingsInput): Promise<void> {
  const values: Record<string, string> = {
    [KEY.enabled]: String(input.enabled),
    [KEY.rewardPoints]: String(input.rewardPoints),
    [KEY.yearlyCap]: String(input.yearlyCap),
    [KEY.qualifyDays]: String(input.qualifyDays),
  }
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     SELECT k, v, NOW() FROM UNNEST($1::text[], $2::text[]) AS t(k, v)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [Object.keys(values), Object.values(values)]
  )
}

// Rewards are paid in loyalty points, so the program only runs while loyalty runs too.
export async function isReferralLive(): Promise<boolean> {
  const [referral, loyalty] = await Promise.all([getReferralSettings(), getLoyaltySettings()])
  return referral.enabled && loyalty.enabled
}
