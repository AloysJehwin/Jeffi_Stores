import { describe, it, expect, vi, beforeEach } from 'vitest'

// getHomepagePlan dynamically imports the plan gate; mock it.
vi.mock('@/lib/auth/plan-gate', () => ({ currentTenantPlanGate: vi.fn() }))

import {
  getHomepagePlan,
  planAllowsType,
  planAllowsAudience,
  planName,
  homepagePlanRefusal,
  type HomepagePlan,
} from '@/lib/catalog/homepage-plan'
import { BUSINESS_PLAN_SCOPE } from '@/lib/catalog/homepage-sections'
import { currentTenantPlanGate as _gate } from '@/lib/auth/plan-gate'

const currentTenantPlanGate = vi.mocked(_gate)

beforeEach(() => currentTenantPlanGate.mockReset())

const basePlan = (over: Partial<HomepagePlan> = {}): HomepagePlan => ({
  types: ['hero', 'product_row'],
  business: true,
  upgrade: {},
  businessUpgrade: null,
  ...over,
})

describe('getHomepagePlan', () => {
  it('includes every type when all scopes are allowed', async () => {
    currentTenantPlanGate.mockResolvedValue({ allowed: true, upgradeRequired: null } as any)
    const plan = await getHomepagePlan()
    // business_cta has a plan scope; allowed means it's included.
    expect(plan.types).toContain('business_cta')
    expect(plan.types).toContain('hero')
    expect(plan.business).toBe(true)
    expect(plan.upgrade).toEqual({})
    expect(plan.businessUpgrade).toBeNull()
  })

  it('drops gated types and records the upgrade hint when a scope is denied', async () => {
    // business_cta + business audience ride BUSINESS_PLAN_SCOPE; deny it, allow the rest.
    currentTenantPlanGate.mockImplementation(async (scope: string) =>
      (scope === BUSINESS_PLAN_SCOPE
        ? { allowed: false, upgradeRequired: 'pro' }
        : { allowed: true, upgradeRequired: null }) as any
    )
    const plan = await getHomepagePlan()
    expect(plan.types).not.toContain('business_cta')
    expect(plan.types).not.toContain('business_reorder')
    expect(plan.upgrade.business_cta).toBe('pro')
    expect(plan.business).toBe(false)
    expect(plan.businessUpgrade).toBe('pro')
    // Ungated types survive.
    expect(plan.types).toContain('hero')
  })

  it('keeps a denied type out but with no hint when upgradeRequired is null', async () => {
    currentTenantPlanGate.mockImplementation(async (scope: string) =>
      (scope === BUSINESS_PLAN_SCOPE
        ? { allowed: false, upgradeRequired: null }
        : { allowed: true, upgradeRequired: null }) as any
    )
    const plan = await getHomepagePlan()
    expect(plan.types).not.toContain('business_cta')
    expect(plan.upgrade.business_cta).toBeUndefined()
    expect(plan.businessUpgrade).toBeNull()
  })

  it('treats a gate lookup failure as denied (allowed:false)', async () => {
    // One scope rejects; its .catch(() => allowed:false) applies, the rest resolve allowed.
    currentTenantPlanGate.mockImplementation(async (scope: string) => {
      if (scope === BUSINESS_PLAN_SCOPE) throw new Error('boom')
      return { allowed: true, upgradeRequired: null } as any
    })
    const plan = await getHomepagePlan()
    expect(plan.business).toBe(false)
    expect(plan.businessUpgrade).toBeNull()
    // Gated types removed; ungated ones remain.
    expect(plan.types).toContain('hero')
    expect(plan.types).not.toContain('business_cta')
  })
})

describe('planAllowsType / planAllowsAudience', () => {
  it('planAllowsType reflects membership', () => {
    const plan = basePlan()
    expect(planAllowsType(plan, 'hero')).toBe(true)
    expect(planAllowsType(plan, 'about')).toBe(false)
  })

  it('store audience is always allowed; business depends on the plan', () => {
    expect(planAllowsAudience(basePlan({ business: false }), 'store')).toBe(true)
    expect(planAllowsAudience(basePlan({ business: false }), 'business')).toBe(false)
    expect(planAllowsAudience(basePlan({ business: true }), 'business')).toBe(true)
  })
})

describe('planName', () => {
  it('maps known slugs to display names', () => {
    expect(planName('basic')).toBe('Basic')
    expect(planName('growth')).toBe('Grow')
    expect(planName('pro')).toBe('Pro')
    expect(planName('enterprise')).toBe('Enterprise')
  })

  it('returns the slug itself when unknown, and null for empty', () => {
    expect(planName('custom')).toBe('custom')
    expect(planName(null)).toBeNull()
    expect(planName(undefined)).toBeNull()
  })
})

describe('homepagePlanRefusal', () => {
  it('returns null when audience and type are both allowed', () => {
    expect(homepagePlanRefusal(basePlan(), { type: 'hero', audience: 'store' })).toBeNull()
  })

  it('refuses the business homepage with the needed plan named', () => {
    const plan = basePlan({ business: false, businessUpgrade: 'pro' })
    const msg = homepagePlanRefusal(plan, { audience: 'business' })
    expect(msg).toContain("business homepage isn't included")
    expect(msg).toContain('it comes with Pro')
  })

  it('refuses the business homepage without a plan name when none is known', () => {
    const plan = basePlan({ business: false, businessUpgrade: null })
    const msg = homepagePlanRefusal(plan, { audience: 'business' })
    expect(msg).toContain("business homepage isn't included")
    expect(msg).not.toContain('it comes with')
  })

  it('refuses a gated type with the needed plan named', () => {
    const plan = basePlan({ types: ['hero'], upgrade: { about: 'growth' } })
    const msg = homepagePlanRefusal(plan, { type: 'about', audience: 'store' })
    expect(msg).toContain("isn't included in your plan")
    expect(msg).toContain('it comes with Grow')
  })

  it('refuses a gated type without a plan name when none is known', () => {
    const plan = basePlan({ types: ['hero'], upgrade: {} })
    const msg = homepagePlanRefusal(plan, { type: 'about', audience: 'store' })
    expect(msg).toContain("isn't included in your plan")
    expect(msg).not.toContain('it comes with')
  })

  it('defaults audience to store when omitted', () => {
    const plan = basePlan({ business: false })
    expect(homepagePlanRefusal(plan, { type: 'hero' })).toBeNull()
  })
})
