// Client-safe subscription constants. No server imports here.

export type SubscriptionInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export const SUBSCRIPTION_INTERVALS: SubscriptionInterval[] = ['weekly', 'monthly', 'quarterly', 'yearly']

export const SUBSCRIPTION_INTERVAL_LABELS: Record<SubscriptionInterval, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
}

export function isSubscriptionInterval(v: unknown): v is SubscriptionInterval {
  return typeof v === 'string' && (SUBSCRIPTION_INTERVALS as string[]).includes(v)
}

/** RBI UPI Autopay frictionless (no AFA per debit) cap per cycle. */
export const MAX_CYCLE_AMOUNT_INR = 15000

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  created: 'Awaiting payment',
  authenticated: 'Starting',
  pending: 'Payment retrying',
  halted: 'Payment failed',
  paused: 'Paused',
  cancelled: 'Cancelled',
  completed: 'Completed',
  expired: 'Expired',
}

/** Razorpay plan period/interval, cycle cap and the legacy interval_minutes for each interval. */
export const INTERVAL_SPEC: Record<
  SubscriptionInterval,
  { period: 'weekly' | 'monthly' | 'yearly'; interval: number; totalCount: number; minutes: number }
> = {
  weekly: { period: 'weekly', interval: 1, totalCount: 520, minutes: 10080 },
  monthly: { period: 'monthly', interval: 1, totalCount: 120, minutes: 43200 },
  quarterly: { period: 'monthly', interval: 3, totalCount: 40, minutes: 129600 },
  yearly: { period: 'yearly', interval: 1, totalCount: 10, minutes: 525600 },
}

export const MAX_BILLING_CYCLES = 520

/** Admin input → stored cycle count: integer 1..520, else null (no limit). */
export function normalizeCycleCount(x: unknown): number | null {
  if (x == null || (typeof x === 'string' && x.trim() === '')) return null
  const n = Number(x)
  if (!Number.isInteger(n) || n < 1 || n > MAX_BILLING_CYCLES) return null
  return n
}

export function cycleLimitsError(totalCycles: number | null, minCycles: number | null): string | null {
  if (totalCycles != null && minCycles != null && minCycles > totalCycles) {
    return 'Minimum billing cycles cannot exceed the number of billing cycles'
  }
  return null
}

/** "12 charges, then it ends" / "Until you cancel". */
export function billingCyclesLabel(totalCycles: number | null | undefined, isDigital: boolean): string {
  if (!totalCycles) return 'Until you cancel'
  const noun = isDigital ? (totalCycles === 1 ? 'charge' : 'charges') : totalCycles === 1 ? 'delivery' : 'deliveries'
  return `${totalCycles} ${noun}, then it ends`
}
