import {
  BUSINESS_PLAN_SCOPE,
  SECTION_META,
  SECTION_TYPES,
  type HomepageAudience,
  type SectionType,
} from '@/lib/catalog/homepage-sections'

/** What the tenant's plan includes of the homepage. */
export interface HomepagePlan {
  /** Section types the plan includes; the others are neither offered nor rendered. */
  types: SectionType[]
  /** Whether the plan has the business homepage (the B2B portal). */
  business: boolean
  /** The lowest plan that unlocks each type the plan lacks, for the admin's upgrade hint. */
  upgrade: Partial<Record<SectionType, string>>
  businessUpgrade: string | null
}

const PLAN_SCOPES = [
  ...new Set([BUSINESS_PLAN_SCOPE, ...SECTION_TYPES.map(t => SECTION_META[t].plan).filter((s): s is string => !!s)]),
]

/** The current tenant's homepage entitlements: one plan lookup per scope, cached by planGate. */
export async function getHomepagePlan(): Promise<HomepagePlan> {
  const { currentTenantPlanGate } = await import('@/lib/auth/plan-gate')
  const gates = new Map(
    await Promise.all(
      PLAN_SCOPES.map(
        async scope =>
          [scope, await currentTenantPlanGate(scope).catch(() => ({ allowed: false, upgradeRequired: null }))] as const
      )
    )
  )
  const upgrade: Partial<Record<SectionType, string>> = {}
  const types = SECTION_TYPES.filter(t => {
    const scope = SECTION_META[t].plan
    const gate = scope ? gates.get(scope) : null
    if (!gate || gate.allowed) return true
    if (gate.upgradeRequired) upgrade[t] = gate.upgradeRequired
    return false
  })
  const business = gates.get(BUSINESS_PLAN_SCOPE)
  return {
    types,
    business: !!business?.allowed,
    upgrade,
    businessUpgrade: business?.allowed ? null : (business?.upgradeRequired ?? null),
  }
}

export const planAllowsType = (plan: HomepagePlan, type: SectionType) => plan.types.includes(type)

export const planAllowsAudience = (plan: HomepagePlan, audience: HomepageAudience) =>
  audience === 'store' || plan.business

const PLAN_NAMES: Record<string, string> = { basic: 'Basic', growth: 'Grow', pro: 'Pro', enterprise: 'Enterprise' }

export const planName = (slug: string | null | undefined) => (slug ? (PLAN_NAMES[slug] ?? slug) : null)

/** Why an admin can't add or edit this on the current plan, or null when they can. */
export function homepagePlanRefusal(
  plan: HomepagePlan,
  { type, audience = 'store' }: { type?: SectionType; audience?: HomepageAudience }
): string | null {
  if (!planAllowsAudience(plan, audience)) {
    const needed = planName(plan.businessUpgrade)
    return `The business homepage isn't included in your plan${needed ? `; it comes with ${needed}` : ''}.`
  }
  if (type && !planAllowsType(plan, type)) {
    const needed = planName(plan.upgrade[type])
    return `${SECTION_META[type].label} isn't included in your plan${needed ? `; it comes with ${needed}` : ''}.`
  }
  return null
}
