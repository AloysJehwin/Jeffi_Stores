// GA4 events for the ecom.jeffistores.in sign-up funnel. The ecom host loads the flagship Google tag, so
// these land in the same property as the store; filter by hostname to report the two apart.

type Gtag = (...args: unknown[]) => void

const CURRENCY = 'INR'
const PURCHASED_KEY = 'jeffi_ga_plan_purchased'

export interface PlanInfo {
  slug: string
  name?: string | null
  monthlyPrice: number | string | null | undefined
  interval?: string | null
}

function gtag(): Gtag | null {
  if (typeof window === 'undefined') return null
  const g = (window as unknown as { gtag?: Gtag }).gtag
  return typeof g === 'function' ? g : null
}

/** Yearly billing is ten months' price (two months free), as in the onboarding wizard. */
export function planPrice(plan: PlanInfo): number {
  const monthly = Number(plan.monthlyPrice) || 0
  return plan.interval === 'yearly' ? monthly * 10 : monthly
}

function planParams(plan: PlanInfo) {
  const price = planPrice(plan)
  return {
    currency: CURRENCY,
    value: price,
    items: [
      {
        item_id: `plan_${plan.slug}`,
        item_name: `${plan.name || plan.slug} plan`,
        item_category: 'subscription',
        item_variant: plan.interval || 'monthly',
        price,
        quantity: 1,
      },
    ],
  }
}

export function trackOwnerAuth(mode: 'signup' | 'signin', method: 'email' | 'google'): void {
  gtag()?.('event', mode === 'signup' ? 'sign_up' : 'login', { method })
}

/** Application sent for review; the store is not paid for yet. */
export function trackStoreApplication(plan: PlanInfo): void {
  gtag()?.('event', 'generate_lead', planParams(plan))
}

export function trackSubscriptionCheckout(plan: PlanInfo): void {
  gtag()?.('event', 'begin_checkout', planParams(plan))
}

/** Once per subscription per browser; GA also dedupes purchases on transaction_id. */
export function trackSubscriptionPurchase(subscriptionId: string, plan: PlanInfo): void {
  const g = gtag()
  if (!g || !subscriptionId) return
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(PURCHASED_KEY) || '[]')
    if (seen.includes(subscriptionId)) return
    localStorage.setItem(PURCHASED_KEY, JSON.stringify([...seen, subscriptionId].slice(-20)))
  } catch {}
  g('event', 'purchase', { transaction_id: subscriptionId, ...planParams(plan) })
}
