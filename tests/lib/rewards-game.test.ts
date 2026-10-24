import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))

import { rewardsGameConfig, rewardsGamePlayable, rewardsGamePublic } from '@/lib/catalog/homepage-sections'
import { nextPeriodStart, pickPrize } from '@/lib/rewards/game'

const KEY = '7f3c2b1a-1111-4222-8333-444455556666'
const prize = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, kind: 'fixed', value: 100, ...extra })

describe('rewardsGameConfig', () => {
  it('keeps only well-formed prizes and normalises the rest', () => {
    const game = rewardsGameConfig({
      config: {
        gameKey: KEY,
        mode: 'scratch',
        playLimit: 'weekly',
        prizes: [
          prize('a', { kind: 'percent', value: 10, maxDiscount: 150, validDays: 400, weight: 3 }),
          prize('b', { kind: 'percent', value: 95 }),
          prize('c', { kind: 'fixed', value: 0 }),
          prize('d', { kind: 'none', value: 50, weight: -1 }),
          { label: 'no id' },
          prize('e', { kind: 'bogus', minPurchase: -5 }),
        ],
      },
    })
    expect(game.mode).toBe('scratch')
    expect(game.playLimit).toBe('weekly')
    expect(game.prizes.map(p => p.id)).toEqual(['a', 'd', 'e'])
    expect(game.prizes[0]).toMatchObject({ kind: 'percent', value: 10, maxDiscount: 150, validDays: 365, weight: 3 })
    expect(game.prizes[1]).toMatchObject({ kind: 'none', value: 0, weight: 1, maxDiscount: null })
    expect(game.prizes[2]).toMatchObject({ kind: 'none', minPurchase: 0 })
    expect(rewardsGamePlayable(game)).toBe(true)
  })

  it('publishes only ids, labels and kinds to clients', () => {
    const section = { config: { gameKey: KEY, prizes: [prize('a', { weight: 9, minPurchase: 999 }), prize('b', { kind: 'none' })] } }
    expect(rewardsGamePublic(section)).toEqual({
      gameKey: KEY,
      mode: 'wheel',
      playLimit: 'once',
      prizes: [
        { id: 'a', label: 'a', kind: 'fixed' },
        { id: 'b', label: 'b', kind: 'none' },
      ],
    })
    expect(JSON.stringify(rewardsGamePublic(section))).not.toMatch(/weight|minPurchase|validDays|value/)
    expect(rewardsGamePublic({ config: { gameKey: KEY, prizes: [prize('a')] } })).toBeNull()
  })

  it('is not playable without a key or with fewer than two prizes', () => {
    expect(rewardsGamePlayable(rewardsGameConfig({ config: { prizes: [prize('a'), prize('b')] } }))).toBe(false)
    expect(rewardsGamePlayable(rewardsGameConfig({ config: { gameKey: KEY, prizes: [prize('a')] } }))).toBe(false)
    expect(rewardsGameConfig({ config: { gameKey: 'not-a-uuid' } }).gameKey).toBeNull()
  })
})

describe('pickPrize', () => {
  const prizes = rewardsGameConfig({
    config: { gameKey: KEY, prizes: [prize('rare', { weight: 1 }), prize('common', { weight: 9 })] },
  }).prizes

  it('follows the weights', () => {
    expect(pickPrize(prizes, 0).id).toBe('rare')
    expect(pickPrize(prizes, 0.0999).id).toBe('rare')
    expect(pickPrize(prizes, 0.1).id).toBe('common')
    expect(pickPrize(prizes, 0.999999).id).toBe('common')
  })

  it('lands near the weights over many rolls', () => {
    let rare = 0
    for (let i = 0; i < 20_000; i++) if (pickPrize(prizes).id === 'rare') rare++
    expect(rare / 20_000).toBeGreaterThan(0.07)
    expect(rare / 20_000).toBeLessThan(0.13)
  })
})

describe('nextPeriodStart', () => {
  // 2026-10-24 is a Saturday; 18:30 UTC is midnight IST.
  const sat = new Date('2026-10-24T10:00:00Z')
  it('is null for a once-only game', () => {
    expect(nextPeriodStart('once', sat)).toBeNull()
  })
  it('is the next IST midnight for a daily game', () => {
    expect(nextPeriodStart('daily', sat)).toBe('2026-10-24T18:30:00.000Z')
  })
  it('is the coming Monday at IST midnight for a weekly game', () => {
    expect(nextPeriodStart('weekly', sat)).toBe('2026-10-25T18:30:00.000Z')
    expect(nextPeriodStart('weekly', new Date('2026-10-26T05:00:00Z'))).toBe('2026-11-01T18:30:00.000Z')
  })
})
