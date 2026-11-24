import type { BillingLine } from '@controller/lib/billing/lines'
import type { BillingSubscription } from '@controller/lib/billing/subscription'

export const DAY = 86_400_000
export const NOW = Date.parse('2026-12-10T00:00:00Z')
export const iso = (ms: number) => new Date(ms).toISOString()
export const T = '11111111-1111-4111-8111-111111111111'

let n = 0
export function line(o: Partial<BillingLine> = {}): BillingLine {
  n++
  return {
    id: `l${n}`,
    tenantId: T,
    kind: 'ad_free',
    ref: '',
    amountPaise: 50000,
    status: 'active',
    subscriptionId: null,
    nextAmountPaise: null,
    changesAt: null,
    trialEndsAt: null,
    endsAt: null,
    graceUntil: null,
    legacyRef: null,
    lastNotice: null,
    createdAt: iso(NOW - 100 * DAY + n),
    ...o,
  }
}

export function sub(o: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: 'bs-cur',
    tenantId: T,
    razorpaySubscriptionId: 'sub_cur',
    razorpayPlanId: 'plan_1',
    mode: 'test',
    status: 'active',
    isCurrent: true,
    interval: 'monthly',
    amountPaise: 50000,
    upfrontPaise: 0,
    lines: [],
    pendingChange: null,
    paymentMethod: 'upi',
    replacesId: null,
    startAt: null,
    // A 30-day cycle with 15 days left.
    currentStart: iso(NOW - 15 * DAY),
    currentEnd: iso(NOW + 15 * DAY),
    graceUntil: null,
    lastEventAt: null,
    checkoutUrl: null,
    createdAt: iso(NOW - 60 * DAY),
    ...o,
  }
}
