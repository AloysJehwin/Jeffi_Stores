import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ enqueueSocialPost: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))
vi.mock('@/lib/social/accounts', () => ({ authFor: vi.fn(), listAccounts: vi.fn() }))

const { triggersFor, fillTemplate } = await import('@/lib/social/jobs')
const { evaluateSocial, SOCIAL_DEFAULTS } = await import('@/lib/social/alerts')

const now = new Date('2026-10-16T10:00:00Z').getTime()
const product = (over = {}) => ({ id: 'p', name: 'Drill', slug: 'drill', price: 900, in_stock: true, created_at: '2026-10-16T05:00:00Z', image_url: 'x', ...over })

describe('triggersFor', () => {
  it('counts a never-seen product as new only when created in the last day', () => {
    expect(triggersFor(product(), undefined, 10, now)).toEqual(['new_product'])
    expect(triggersFor(product({ created_at: '2026-09-01T00:00:00Z' }), undefined, 10, now)).toEqual([])
  })
  it('fires back in stock once, on the change', () => {
    expect(triggersFor(product(), { in_stock: false, price: 900 }, 10, now)).toEqual(['back_in_stock'])
    expect(triggersFor(product(), { in_stock: true, price: 900 }, 10, now)).toEqual([])
  })
  it('fires a price drop only at the set percentage', () => {
    expect(triggersFor(product({ price: 900 }), { in_stock: true, price: 1000 }, 10, now)).toEqual(['price_drop'])
    expect(triggersFor(product({ price: 950 }), { in_stock: true, price: 1000 }, 10, now)).toEqual([])
  })
})

describe('fillTemplate', () => {
  it('fills name, price, old price and url', () => {
    expect(fillTemplate('{name} now {price} (was {old_price}) {url}', { name: 'Drill', price: 1999, oldPrice: 2499, url: 'https://s/p' })).toBe(
      'Drill now Rs 1,999 (was Rs 2,499) https://s/p'
    )
  })
})

describe('evaluateSocial', () => {
  const base = { failed: [], accounts: [], approvalWaiting: 0, unanswered: [] }
  const at = new Date('2026-10-16T00:00:00Z')
  it('alerts on a Meta token about to expire but not on tokens that refresh themselves', () => {
    const f = evaluateSocial(
      {
        ...base,
        accounts: [
          { provider: 'facebook', status: 'connected', expiresAt: '2026-10-19T00:00:00Z', hasRefresh: false },
          { provider: 'x', status: 'connected', expiresAt: '2026-10-16T02:00:00Z', hasRefresh: true },
        ],
      },
      SOCIAL_DEFAULTS,
      at
    )
    expect(f.map(x => x.key)).toEqual(['token_expiry:facebook'])
  })
  it('flags failed posts, a missing target, approvals and unanswered comments', () => {
    const f = evaluateSocial(
      {
        failed: [{ id: 'p1', platform: 'x', error: 'boom' }],
        accounts: [{ provider: 'pinterest', status: 'pending', expiresAt: null, hasRefresh: true }],
        approvalWaiting: 2,
        unanswered: [{ network: 'instagram', n: 3 }],
      },
      SOCIAL_DEFAULTS,
      at
    )
    expect(f.map(x => x.rule).sort()).toEqual(['approval_waiting', 'failed_posts', 'needs_target', 'unanswered'])
  })
})
