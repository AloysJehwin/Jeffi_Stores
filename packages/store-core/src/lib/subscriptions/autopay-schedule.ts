// PhonePe Autopay scheduling rules (pure; no server imports). docs/PAYMENTS_UPI.md, "PhonePe Autopay".

import { INTERVAL_SPEC, isSubscriptionInterval, type SubscriptionInterval } from './intervals'

const HOUR = 3600_000
const DAY = 24 * HOUR

/** Start notifying this long before the due date, so the 24 h notice is over by then. */
export const NOTIFY_LEAD_MS = 36 * HOUR
/** NPCI: a debit may only run 24 h after its pre-debit notification. */
export const MIN_NOTICE_MS = 24 * HOUR
/** How long the redemption order stays open after it may first be executed (PhonePe retries inside it). */
export const REDEMPTION_WINDOW_MS = 48 * HOUR
/** A cycle paid this late starts its period on the payment date instead of the missed due date. */
export const LATE_RESTART_MS = 3 * DAY
/** A mandate setup nobody finished is abandoned after this long. */
export const SETUP_ABANDON_MS = 2 * HOUR

export type AutopayFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'

export const AUTOPAY_FREQUENCY: Record<SubscriptionInterval, AutopayFrequency> = {
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  quarterly: 'QUARTERLY',
  yearly: 'YEARLY',
}

export function asInterval(v: unknown): SubscriptionInterval {
  return isSubscriptionInterval(v) ? v : 'monthly'
}

/** Calendar-aware: a month-end start stays on the last day of shorter months. */
export function addInterval(from: Date, interval: SubscriptionInterval, count = 1): Date {
  if (interval === 'weekly') return new Date(from.getTime() + 7 * DAY * count)
  const months = (interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12) * count
  const d = new Date(from.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

/** Mandate end: one week after the last cycle that could be charged. */
export function mandateExpiry(start: Date, interval: SubscriptionInterval, totalCount: number | null | undefined): Date {
  const cycles = totalCount && totalCount > 0 ? totalCount : INTERVAL_SPEC[interval].totalCount
  return new Date(addInterval(start, interval, cycles).getTime() + 7 * DAY)
}

/** The period a paid cycle covers. `dueAt` null = the first cycle (paid at sign-up). */
export function cyclePeriod(interval: SubscriptionInterval, dueAt: Date | null, paidAt: Date): { start: Date; end: Date } {
  const start = !dueAt || paidAt.getTime() - dueAt.getTime() > LATE_RESTART_MS ? paidAt : dueAt
  return { start, end: addInterval(start, interval) }
}

export interface RenewalSub {
  status: string
  current_cycle: number | null
  current_end: string | Date | null
  total_count: number | null
  cancel_at_cycle_end: boolean | null
  phonepe_mandate_state: string | null
}

export type RenewalStep =
  /** Nothing to do yet. */
  | { kind: 'wait' }
  /** Send the pre-debit notification for the next cycle. */
  | { kind: 'notify'; cycle: number; dueAt: Date }
  /** The paid term is over: end the subscription (and the mandate). */
  | { kind: 'end'; as: 'cancelled' | 'completed' }

const date = (v: string | Date | null | undefined) => (v ? new Date(v) : null)

/** What the renewal run does for a subscription that has no open redemption. */
export function nextRenewalStep(sub: RenewalSub, now: Date): RenewalStep {
  if (sub.status !== 'active') return { kind: 'wait' }
  const due = date(sub.current_end)
  if (!due) return { kind: 'wait' }
  const paid = Number(sub.current_cycle ?? 0)
  const total = Number(sub.total_count ?? 0)
  if (sub.cancel_at_cycle_end) return now.getTime() >= due.getTime() ? { kind: 'end', as: 'cancelled' } : { kind: 'wait' }
  if (total > 0 && paid >= total) return now.getTime() >= due.getTime() ? { kind: 'end', as: 'completed' } : { kind: 'wait' }
  const mandate = String(sub.phonepe_mandate_state ?? 'ACTIVE').toUpperCase()
  if (mandate !== 'ACTIVE') return { kind: 'wait' }
  if (now.getTime() < due.getTime() - NOTIFY_LEAD_MS) return { kind: 'wait' }
  return { kind: 'notify', cycle: paid + 1, dueAt: due }
}

/** Earliest moment the debit may run: the due date, but never inside the 24 h notice (or PhonePe's validAfter). */
export function executeAfter(dueAt: Date, notifiedAt: Date, validAfter?: Date | null): Date {
  return new Date(Math.max(dueAt.getTime(), notifiedAt.getTime() + MIN_NOTICE_MS, validAfter?.getTime() ?? 0))
}

/** When the notify order should lapse if it never reaches a terminal state. */
export function redemptionExpiry(dueAt: Date, now: Date): Date {
  return new Date(Math.max(dueAt.getTime(), now.getTime() + MIN_NOTICE_MS) + REDEMPTION_WINDOW_MS)
}

export type RedemptionStatus = 'notifying' | 'notified' | 'executing' | 'completed' | 'failed' | 'cancelled'

export interface RedemptionState {
  status: RedemptionStatus
  execute_after: string | Date | null
}

export type RedemptionStep = 'poll' | 'execute' | 'wait' | 'done'

/** What the renewal run does with an open redemption. */
export function redemptionStep(r: RedemptionState, now: Date): RedemptionStep {
  if (r.status === 'notifying' || r.status === 'executing') return 'poll'
  if (r.status === 'notified') {
    const at = date(r.execute_after)
    return at && now.getTime() >= at.getTime() ? 'execute' : 'wait'
  }
  return 'done'
}

/** PhonePe subscription state → what it means for the local subscription status (null = leave it). */
export function statusForMandateState(state: string | null | undefined): 'active' | 'paused' | 'cancelled' | 'expired' | null {
  switch (String(state ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'active'
    case 'PAUSED':
      return 'paused'
    case 'CANCELLED':
    case 'REVOKED':
      return 'cancelled'
    case 'EXPIRED':
      return 'expired'
    default:
      return null
  }
}
