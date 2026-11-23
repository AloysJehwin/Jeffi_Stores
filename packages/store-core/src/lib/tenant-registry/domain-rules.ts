// Custom-domain rules, read from plans.max_custom_domains: the one source for the pricing page, the Domains
// page and the FAQs. Connecting a domain you already own takes a plan with a quota (addCustomDomain enforces it);
// a domain bought through Jeffi serves the store on any plan (lib/domains/orders.ts).

export interface DomainPlan {
  slug: string
  name: string
  tier: number
  max_custom_domains: number | string | null
}

const quota = (p: DomainPlan) => Number(p.max_custom_domains) || 0

/** The cheapest plan that can connect a domain the owner already has, or null when none can. */
export function firstOwnDomainPlan<P extends DomainPlan>(plans: P[]): P | null {
  return [...plans].sort((a, b) => a.tier - b.tier).find(p => quota(p) > 0) ?? null
}

/** "Pro plan and above", or null when no plan connects an owned domain. */
export function ownDomainFrom(plans: DomainPlan[]): string | null {
  const p = firstOwnDomainPlan(plans)
  return p ? `${p.name} plan and above` : null
}

/** One plan's cell in a comparison: what it allows. */
export function domainAllowance(max: number | string | null): string {
  const n = Number(max) || 0
  return n === 0 ? 'Buy one through Jeffi' : `${n} of your own, or buy one`
}

/** The FAQ answer, built from the plans. */
export function domainFaqAnswer(plans: DomainPlan[]): string {
  const buy = 'Yes. On any plan you can buy a domain through Jeffi and we connect it, with the certificate and DNS handled.'
  const owned = [...plans].sort((a, b) => a.tier - b.tier).filter(p => quota(p) > 0)
  if (!owned.length) return buy
  const list = owned.map(p => `${p.name} ${quota(p)}`).join(', ')
  return `${buy} To connect a domain you already own you need the ${owned[0].name} plan or above (${list}).`
}
