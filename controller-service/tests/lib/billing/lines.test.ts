import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) }))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 400 }) }))

import {
  chargedAt,
  cyclePaise,
  effectivePaise,
  listPricePaise,
  MANDATE_LIMIT_PAISE,
  monthlyTotal,
  paymentMethodsFor,
  sameLine,
  toLine,
} from '@controller/lib/billing/lines'
import { DAY, NOW, iso, line } from './fixtures'

describe('chargedAt', () => {
  it('covers active and awaiting lines, an ending one until its end, a trial once it ends', () => {
    expect(chargedAt(line({ status: 'active' }), NOW)).toBe(true)
    expect(chargedAt(line({ status: 'awaiting_payment' }), NOW)).toBe(true)
    expect(chargedAt(line({ status: 'ending', endsAt: iso(NOW + DAY) }), NOW)).toBe(true)
    expect(chargedAt(line({ status: 'ending', endsAt: iso(NOW - DAY) }), NOW)).toBe(false)
    expect(chargedAt(line({ status: 'trial', trialEndsAt: iso(NOW + 5 * DAY) }), NOW)).toBe(false)
    // A day of slack: a charge the day before the trial ends covers it.
    expect(chargedAt(line({ status: 'trial', trialEndsAt: iso(NOW + DAY / 2) }), NOW)).toBe(true)
    expect(chargedAt(line({ status: 'legacy_wallet' }), NOW)).toBe(false)
    expect(chargedAt(line({ status: 'ended' }), NOW)).toBe(false)
  })
})

describe('effectivePaise and monthlyTotal', () => {
  it('drops a downgraded line to its next price from changes_at', () => {
    const l = line({ amountPaise: 300000, nextAmountPaise: 200000, changesAt: iso(NOW + 10 * DAY) })
    expect(effectivePaise(l, [l], NOW)).toBe(300000)
    expect(effectivePaise(l, [l], NOW + 10 * DAY)).toBe(200000)
  })

  it('includes the first Showcase site in a store plan (decision 9), each extra one is charged', () => {
    const store = line({ kind: 'store_plan', amountPaise: 299900 })
    const first = line({ kind: 'showcase_site', ref: 'site-a', amountPaise: 20000 })
    const second = line({ kind: 'showcase_site', ref: 'site-b', amountPaise: 20000 })
    const all = [store, first, second]
    expect(effectivePaise(first, all, NOW)).toBe(0)
    expect(effectivePaise(second, all, NOW)).toBe(20000)
    expect(monthlyTotal(all, NOW)).toBe(299900 + 20000)
    // Without a store, every site is charged.
    expect(monthlyTotal([first, second], NOW)).toBe(40000)
  })

  it('takes a custom bill predicate (a chosen trial counts before it ends)', () => {
    const trial = line({ kind: 'showcase_site', ref: 's', amountPaise: 20000, status: 'trial', trialEndsAt: iso(NOW + 5 * DAY) })
    expect(monthlyTotal([trial], NOW)).toBe(0)
    expect(monthlyTotal([trial], NOW, () => true)).toBe(20000)
  })

  it('bills yearly at ten months for every line (decision 10)', () => {
    expect(cyclePaise(50000, 'monthly')).toBe(50000)
    expect(cyclePaise(50000, 'yearly')).toBe(500000)
  })
})

describe('paymentMethodsFor', () => {
  it('allows only eMandate or a card above the mandate limit (decision 12)', () => {
    expect(paymentMethodsFor(MANDATE_LIMIT_PAISE)).toEqual(['upi', 'card', 'emandate'])
    expect(paymentMethodsFor(MANDATE_LIMIT_PAISE + 1)).toEqual(['card', 'emandate'])
  })
})

describe('helpers', () => {
  it('matches lines by kind and ref', () => {
    expect(sameLine({ kind: 'showcase_site', ref: 'a' }, { kind: 'showcase_site', ref: 'a' })).toBe(true)
    expect(sameLine({ kind: 'showcase_site', ref: 'a' }, { kind: 'showcase_site', ref: 'b' })).toBe(false)
    expect(sameLine({ kind: 'ad_free' }, { kind: 'ad_free', ref: '' })).toBe(true)
  })

  it('maps a row', () => {
    const l = toLine({ id: 'x', tenant_id: 't', kind: 'ad_free', ref: null, amount_paise: '50000', status: 'active', created_at: '2026-12-01T00:00:00Z' })
    expect(l).toMatchObject({ id: 'x', tenantId: 't', ref: '', amountPaise: 50000, nextAmountPaise: null, trialEndsAt: null })
  })

  it('prices new lines from the current list prices', async () => {
    expect(await listPricePaise('showcase_site', 't')).toBe(20000)
    expect(await listPricePaise('ad_free', 't')).toBe(50000)
    expect(await listPricePaise('messaging_addon', 't')).toBe(40000)
  })
})
