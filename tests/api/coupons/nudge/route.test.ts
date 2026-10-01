import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/(public)/coupons/nudge/route'
import { queryMany } from '@/lib/shared/db'
import { authenticateAnyUser } from '@/lib/auth/jwt'

const USER_ID = '550e8400-e29b-41d4-a716-446655440001'

function coupon(overrides: Record<string, unknown> = {}) {
  return {
    code: 'SAVE10',
    discount_type: 'percentage',
    discount_value: 10,
    min_purchase: 0,
    max_discount: null,
    ...overrides,
  }
}

async function nudgeFor(subtotal?: string) {
  const url = new URL('http://localhost/api/coupons/nudge')
  if (subtotal !== undefined) url.searchParams.set('subtotal', subtotal)
  const res = await GET(new Request(url) as any)
  return { status: res.status, body: await res.json(), headers: res.headers }
}

describe('GET /api/coupons/nudge — validation', () => {
  it.each([undefined, 'abc', '-5'])('rejects subtotal=%s with 400', async subtotal => {
    const { status, body } = await nudgeFor(subtotal)
    expect(status).toBe(400)
    expect(body.error).toBe('Invalid request')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns no nudge for an empty cart without querying', async () => {
    const { status, body } = await nudgeFor('0')
    expect(status).toBe(200)
    expect(body).toEqual({ nudge: null })
    expect(queryMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/coupons/nudge — public coupons only', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('filters out drafts, inactive, expired, exhausted and every kind of targeted coupon in SQL', async () => {
    await nudgeFor('500')
    const sql = vi.mocked(queryMany).mock.calls[0]![0] as string
    for (const guard of [
      'c.is_active = TRUE',
      'c.is_draft = FALSE',
      'c.auto_generated = FALSE',
      'c.generated_for_user_id IS NULL',
      'c.generated_for_campaign IS NULL',
      'c.valid_from IS NULL OR c.valid_from <= NOW()',
      'c.valid_until IS NULL OR c.valid_until >= NOW()',
      'c.usage_limit IS NULL OR COALESCE(c.times_used, 0) < c.usage_limit',
      'NOT EXISTS (SELECT 1 FROM coupon_eligible_users',
      'NOT EXISTS (SELECT 1 FROM campaigns',
      'NOT EXISTS (SELECT 1 FROM review_forms',
      "NOT EXISTS (SELECT 1 FROM email_campaigns ec WHERE ec.audience_filter->>'couponId' = c.id::text)",
      'c.usage_limit_per_user',
    ]) {
      expect(sql).toContain(guard)
    }
  })

  it('passes null for a guest so the per-user limit is not applied', async () => {
    await nudgeFor('500')
    expect(vi.mocked(queryMany).mock.calls[0]![1]).toEqual([null])
  })

  it('passes the signed-in user id so exhausted per-user coupons are skipped', async () => {
    vi.mocked(authenticateAnyUser).mockResolvedValue({ userId: USER_ID } as any)
    await nudgeFor('500')
    expect(vi.mocked(queryMany).mock.calls[0]![1]).toEqual([USER_ID])
  })

  it('returns no nudge when there are no public coupons', async () => {
    const { body } = await nudgeFor('500')
    expect(body).toEqual({ nudge: null })
  })

  it('fails soft with no nudge when the query errors', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { status, body } = await nudgeFor('500')
    expect(status).toBe(200)
    expect(body).toEqual({ nudge: null })
    errSpy.mockRestore()
  })
})

describe('GET /api/coupons/nudge — picking the best coupon', () => {
  beforeEach(() => {
    vi.mocked(authenticateAnyUser).mockResolvedValue(null)
  })

  it('picks the applicable coupon with the largest saving, honouring the percentage cap', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      coupon({ code: 'PCT10', discount_value: 10, max_discount: 150 }),
      coupon({ code: 'FLAT180', discount_type: 'fixed', discount_value: 180 }),
    ])
    const { body } = await nudgeFor('2000')
    expect(body.nudge).toEqual({ code: 'FLAT180', saving: 180, shortfall: 0 })
  })

  it('computes a percentage saving on the cart subtotal', async () => {
    vi.mocked(queryMany).mockResolvedValue([coupon({ code: 'SAVE10' })])
    const { body } = await nudgeFor('1234.5')
    expect(body.nudge).toEqual({ code: 'SAVE10', saving: 123.45, shortfall: 0 })
  })

  it('never promises more than the cart is worth', async () => {
    vi.mocked(queryMany).mockResolvedValue([coupon({ code: 'FLAT500', discount_type: 'fixed', discount_value: 500 })])
    const { body } = await nudgeFor('300')
    expect(body.nudge.saving).toBe(300)
  })

  it('prefers a coupon that applies now over a bigger one that is still locked', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      coupon({ code: 'SMALL', discount_type: 'fixed', discount_value: 20 }),
      coupon({ code: 'BIG', discount_type: 'fixed', discount_value: 400, min_purchase: 1000 }),
    ])
    const { body } = await nudgeFor('800')
    expect(body.nudge).toEqual({ code: 'SMALL', saving: 20, shortfall: 0 })
  })

  it('suggests the nearest locked coupon with the amount still needed and its saving at the minimum', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      coupon({ code: 'FAR', discount_type: 'fixed', discount_value: 300, min_purchase: 1200 }),
      coupon({ code: 'NEAR', discount_value: 10, min_purchase: 1000 }),
    ])
    const { body } = await nudgeFor('800')
    expect(body.nudge).toEqual({ code: 'NEAR', saving: 100, shortfall: 200 })
  })

  it('breaks a shortfall tie by the larger saving', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      coupon({ code: 'LESS', discount_type: 'fixed', discount_value: 50, min_purchase: 1000 }),
      coupon({ code: 'MORE', discount_type: 'fixed', discount_value: 90, min_purchase: 1000 }),
    ])
    const { body } = await nudgeFor('900')
    expect(body.nudge.code).toBe('MORE')
  })

  it('does not nudge towards a minimum more than double the cart', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      coupon({ code: 'BULK', discount_type: 'fixed', discount_value: 500, min_purchase: 10000 }),
    ])
    const { body } = await nudgeFor('400')
    expect(body.nudge).toBeNull()
  })

  it('skips coupons whose capped saving is zero', async () => {
    vi.mocked(queryMany).mockResolvedValue([coupon({ code: 'ZERO', max_discount: 0 })])
    const { body } = await nudgeFor('500')
    expect(body.nudge).toBeNull()
  })

  it('returns only the code and amounts, never coupon internals', async () => {
    vi.mocked(queryMany).mockResolvedValue([coupon({ code: 'SAVE10', description: 'internal note' })])
    const { body, headers } = await nudgeFor('500')
    expect(Object.keys(body.nudge).sort()).toEqual(['code', 'saving', 'shortfall'])
    expect(headers.get('Cache-Control')).toBe('private, no-store')
  })
})
