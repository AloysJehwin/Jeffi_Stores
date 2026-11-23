import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/admin/draft-branches', () => ({
  mergeAndPublish: vi.fn().mockResolvedValue('merged'),
}))

import {
  applyCouponContent,
  couponContentOf,
  liveCouponContent,
  couponDrafts,
  publishCouponDraft,
} from '@/lib/catalog/coupon-draft'
import { mergeAndPublish } from '@/lib/admin/draft-branches'

function fakeDb() {
  return { query: vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] as any[] })) }
}

describe('applyCouponContent', () => {
  it('uppercases the code and maps params; no live → false validity flags', async () => {
    const db = fakeDb()
    await applyCouponContent(db as any, 'c1', {
      code: 'save10',
      description: 'd',
      discount_type: 'percent',
      discount_value: 10,
      min_purchase_amount: 100,
      max_discount_amount: 50,
      usage_limit: 5,
      usage_limit_per_user: 1,
      valid_from: '2025-01-01T00:00',
      valid_until: '2025-12-31T00:00',
      is_active: true,
    })
    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('UPDATE coupons SET')
    expect(params[0]).toBe('c1')
    expect(params[1]).toBe('SAVE10')
    expect(params[2]).toBe('d')
    expect(params[11]).toBe(true) // is_active
    expect(params[12]).toBe(false) // no live → valid_from flag
    expect(params[13]).toBe(false)
  })

  it('nulls code when absent and flags validity equal-to-live', async () => {
    const db = fakeDb()
    const live = { valid_from: '2025-01-01T00:00', valid_until: '2025-12-31T00:00' }
    await applyCouponContent(db as any, 'c1', { valid_from: '2025-01-01T00:00', valid_until: '2025-12-31T00:00' }, live)
    const [, params] = db.query.mock.calls[0]
    expect(params[1]).toBeNull()
    expect(params[12]).toBe(true) // dt(valid_from) === live.valid_from
    expect(params[13]).toBe(true)
  })
})

describe('couponContentOf (normalize)', () => {
  it('coerces numerics and leaves a datetime-local string intact', () => {
    const c = couponContentOf({
      code: 'X',
      discount_value: '10',
      min_purchase_amount: '',
      usage_limit: '3',
      valid_from: '2025-01-01T09:30',
      valid_until: null,
    })
    expect(c.discount_value).toBe(10)
    expect(c.min_purchase_amount).toBeNull()
    expect(c.usage_limit).toBe(3)
    expect(c.valid_from).toBe('2025-01-01T09:30')
    expect(c.valid_until).toBeNull()
  })

  it('converts a Date-like string to a 16-char UTC wall time', () => {
    const c = couponContentOf({ valid_from: '2025-06-15T12:00:00.000Z' })
    expect(c.valid_from).toBe('2025-06-15T12:00')
  })

  it('keeps an unparseable date value as-is', () => {
    const c = couponContentOf({ valid_from: 'not-a-date' })
    expect(c.valid_from).toBe('not-a-date')
  })
})

describe('liveCouponContent', () => {
  it('normalised content when present, null otherwise', async () => {
    const db = { query: vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [{ code: 'X', discount_value: '5' }] })) }
    const out = await liveCouponContent(db as any, 'c1')
    expect(out?.discount_value).toBe(5)
    expect(db.query.mock.calls[0][1]).toEqual(['c1'])

    const empty = { query: vi.fn<(...a: any[]) => Promise<{ rows: any[] }>>(async () => ({ rows: [] })) }
    expect(await liveCouponContent(empty as any, 'c1')).toBeNull()
  })
})

describe('couponDrafts adapter', () => {
  it('has the expected identity and labels', () => {
    expect(couponDrafts.type).toBe('coupon')
    expect(couponDrafts.table).toBe('coupon_drafts')
    expect(couponDrafts.entityKey).toBe('coupon_id')
    expect(couponDrafts.labels?.usage_limit).toBe('Usage limit')
  })

  it('toContent keeps and normalises only form fields present', () => {
    const c = couponDrafts.toContent!({ fields: { discount_value: '7', times_used: 3 } } as any)
    expect(c).toEqual({ discount_value: 7 })
  })

  it('toColumns wraps under fields', () => {
    expect(couponDrafts.toColumns!({ code: 'X' })).toEqual({ fields: { code: 'X' } })
  })

  it('lockLive and apply hit the right SQL', async () => {
    const lock = fakeDb()
    await couponDrafts.lockLive!(lock as any, 'c1')
    expect(lock.query.mock.calls[0][0]).toContain('FOR UPDATE')

    const app = fakeDb()
    await couponDrafts.apply!(app as any, 'c1', { code: 'y' }, null as any, {} as any)
    expect(app.query.mock.calls[0][0]).toContain('UPDATE coupons SET')
  })
})

describe('publishCouponDraft', () => {
  it('forwards to mergeAndPublish with defaults', async () => {
    await publishCouponDraft('d1')
    expect(mergeAndPublish).toHaveBeenCalledWith(couponDrafts, 'd1', undefined, {})
  })
})
