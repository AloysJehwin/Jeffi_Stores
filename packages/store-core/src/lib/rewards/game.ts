import crypto from 'crypto'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { insertUserCoupon } from '@/lib/loyalty/coupons'
import { couponStatusSql, type CouponStatus } from './account-coupons'
import {
  isWithinWindow,
  rewardsGameConfig,
  rewardsGamePlayable,
  type HomepageSection,
  type RewardPlayLimit,
  type RewardPrize,
  type RewardsGameConfig,
} from '@/lib/catalog/homepage-sections'

// The homepage rewards game: one play per user per period, a weighted prize, a personal coupon.
// Plays are keyed by the section's gameKey, not its row id: publish recreates rows and a copy onto
// the other surface keeps the key, so limits hold across both.

export const REWARD_GAME_CAMPAIGN_PREFIX = 'reward_game:'
const TZ = 'Asia/Kolkata'

export interface GamePlay {
  prizeId: string
  prizeLabel: string
  playedAt: string
  coupon: {
    id: string
    code: string
    discountType: 'fixed' | 'percentage'
    value: number
    minPurchase: number
    maxDiscount: number | null
    validUntil: string | null
    status: CouponStatus
  } | null
}

export interface GameState {
  canPlay: boolean
  /** When the next play opens, for daily/weekly limits; null for once-only or when a play is available. */
  nextPlayAt: string | null
  lastPlay: GamePlay | null
}

/** The live, active, in-window rewards section carrying this key (either surface). */
export async function findLiveGame(gameKey: string): Promise<RewardsGameConfig | null> {
  const rows = await queryMany<Pick<HomepageSection, 'config' | 'starts_at' | 'ends_at'>>(
    `SELECT config, starts_at, ends_at FROM homepage_sections
     WHERE type = 'rewards_game' AND is_active = true AND config->>'gameKey' = $1
     ORDER BY updated_at DESC`,
    [gameKey]
  )
  for (const row of rows) {
    if (!isWithinWindow(row)) continue
    const game = rewardsGameConfig(row)
    if (rewardsGamePlayable(game)) return game
  }
  return null
}

/** SQL for the period a play counts against, evaluated in the store's timezone. */
const PERIOD_SQL = `CASE $1::text
  WHEN 'daily' THEN to_char(now() AT TIME ZONE '${TZ}', 'YYYY-MM-DD')
  WHEN 'weekly' THEN to_char(now() AT TIME ZONE '${TZ}', 'IYYY-"W"IW')
  ELSE 'once' END`

/** Picks by weight with crypto randomness; the prize list is never empty here. */
export function pickPrize(prizes: RewardPrize[], roll = crypto.randomInt(1_000_000) / 1_000_000): RewardPrize {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0)
  let cursor = roll * total
  for (const prize of prizes) {
    cursor -= prize.weight
    if (cursor < 0) return prize
  }
  return prizes[prizes.length - 1]
}

/** Midnight (daily) or Monday midnight (weekly) in the store's timezone after `now`. */
export function nextPeriodStart(limit: RewardPlayLimit, now = new Date()): string | null {
  if (limit === 'once') return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const y = Number(get('year'))
  const m = Number(get('month'))
  const d = Number(get('day'))
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  const daysAhead = limit === 'daily' ? 1 : ((8 - dow) % 7) || 7
  // IST has no DST, so local midnight is a fixed UTC offset.
  const utc = Date.UTC(y, m - 1, d + daysAhead) - 5.5 * 3_600_000
  return new Date(utc).toISOString()
}

function toPlay(row: PlayRow): GamePlay {
  return {
    prizeId: row.prize_id,
    prizeLabel: row.prize_label,
    playedAt: new Date(row.played_at).toISOString(),
    coupon: row.code && row.coupon_id
      ? {
          id: row.coupon_id,
          code: row.code,
          discountType: row.discount_type === 'percentage' ? 'percentage' : 'fixed',
          value: Number(row.discount_value),
          minPurchase: Number(row.min_purchase_amount ?? 0),
          maxDiscount: row.max_discount_amount == null ? null : Number(row.max_discount_amount),
          validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : null,
          status: row.coupon_status ?? 'usable',
        }
      : null,
  }
}

interface PlayRow {
  prize_id: string
  prize_label: string
  played_at: string
  coupon_id: string | null
  code: string | null
  discount_type: string | null
  discount_value: string | null
  min_purchase_amount: string | null
  max_discount_amount: string | null
  valid_until: string | null
  coupon_status: CouponStatus | null
}

const PLAY_SELECT = `SELECT p.prize_id, p.prize_label, p.played_at, c.id AS coupon_id, c.code, c.discount_type, c.discount_value,
    c.min_purchase_amount, c.max_discount_amount, c.valid_until,
    CASE WHEN c.id IS NULL THEN NULL ELSE ${couponStatusSql('p.user_id')} END AS coupon_status
  FROM reward_game_plays p LEFT JOIN coupons c ON c.id = p.coupon_id`

export async function getGameState(game: RewardsGameConfig, userId: string): Promise<GameState> {
  const current = await queryOne<PlayRow>(
    `${PLAY_SELECT} WHERE p.game_key = $2 AND p.user_id = $3 AND p.period_key = (${PERIOD_SQL})`,
    [game.playLimit, game.gameKey, userId]
  )
  const last =
    current ??
    (await queryOne<PlayRow>(`${PLAY_SELECT} WHERE p.game_key = $1 AND p.user_id = $2 ORDER BY p.played_at DESC LIMIT 1`, [
      game.gameKey,
      userId,
    ]))
  return {
    canPlay: !current,
    nextPlayAt: current ? nextPeriodStart(game.playLimit) : null,
    lastPlay: last ? toPlay(last) : null,
  }
}

export type PlayResult = { ok: true; play: GamePlay; repeated: boolean }

/**
 * One transaction: claim the period with ON CONFLICT DO NOTHING (the unique index is the limit), then
 * issue the coupon for the prize. A repeat in the same period returns the existing play unchanged, so
 * a double tap or a retry can never issue a second coupon.
 */
export async function playGame(game: RewardsGameConfig, userId: string): Promise<PlayResult> {
  const prize = pickPrize(game.prizes)
  return withTransaction<PlayResult>(async client => {
    const claimed = await client.query<{ id: string }>(
      `INSERT INTO reward_game_plays (game_key, user_id, period_key, prize_id, prize_label)
       VALUES ($2, $3, (${PERIOD_SQL}), $4, $5)
       ON CONFLICT (game_key, user_id, period_key) DO NOTHING
       RETURNING id`,
      [game.playLimit, game.gameKey, userId, prize.id, prize.label]
    )
    const playId = claimed.rows[0]?.id
    if (!playId) {
      const existing = await client.query<PlayRow>(
        `${PLAY_SELECT} WHERE p.game_key = $2 AND p.user_id = $3 AND p.period_key = (${PERIOD_SQL})`,
        [game.playLimit, game.gameKey, userId]
      )
      if (!existing.rows[0]) throw new Error('Reward play vanished')
      return { ok: true, play: toPlay(existing.rows[0]), repeated: true }
    }
    if (prize.kind !== 'none') {
      const validUntil = new Date(Date.now() + prize.validDays * 86_400_000)
      const coupon = await insertUserCoupon(client, {
        prefix: 'WIN',
        description: `Rewards game: ${prize.label}`,
        discountType: prize.kind === 'percent' ? 'percentage' : 'fixed',
        value: prize.value,
        minPurchase: prize.minPurchase,
        maxDiscount: prize.maxDiscount,
        validUntil,
        campaign: `${REWARD_GAME_CAMPAIGN_PREFIX}${game.gameKey}`,
        userId,
      })
      await client.query(`UPDATE reward_game_plays SET coupon_id = $1 WHERE id = $2`, [coupon.id, playId])
    }
    const fresh = await client.query<PlayRow>(`${PLAY_SELECT} WHERE p.id = $1`, [playId])
    return { ok: true, play: toPlay(fresh.rows[0]), repeated: false }
  })
}
