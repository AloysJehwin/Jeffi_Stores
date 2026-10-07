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
