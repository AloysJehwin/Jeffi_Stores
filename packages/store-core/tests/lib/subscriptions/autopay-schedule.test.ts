import { describe, expect, it } from 'vitest'
import {
  MIN_NOTICE_MS,
  NOTIFY_LEAD_MS,
  addInterval,
  cyclePeriod,
  executeAfter,
  mandateExpiry,
  nextRenewalStep,
  redemptionExpiry,
  redemptionStep,
  statusForMandateState,
  type RenewalSub,
} from '@/lib/subscriptions/autopay-schedule'

const H = 3600_000
const d = (s: string) => new Date(s)
const sub = (o: Partial<RenewalSub> = {}): RenewalSub => ({
  status: 'active',
  current_cycle: 1,
  current_end: '2026-12-10T06:00:00Z',
  total_count: 120,
  cancel_at_cycle_end: false,
  phonepe_mandate_state: 'ACTIVE',
  ...o,
})

describe('addInterval', () => {
  it('steps weeks, months, quarters and years', () => {
    expect(addInterval(d('2026-11-10T06:00:00Z'), 'weekly').toISOString()).toBe('2026-11-17T06:00:00.000Z')
    expect(addInterval(d('2026-11-10T06:00:00Z'), 'monthly').toISOString()).toBe('2026-12-10T06:00:00.000Z')
    expect(addInterval(d('2026-11-10T06:00:00Z'), 'quarterly').toISOString()).toBe('2027-02-10T06:00:00.000Z')
    expect(addInterval(d('2026-11-10T06:00:00Z'), 'yearly').toISOString()).toBe('2027-11-10T06:00:00.000Z')
  })
  it('clamps a month-end start to the shorter month', () => {
    expect(addInterval(d('2027-01-31T06:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T06:00:00.000Z')
    expect(addInterval(d('2028-02-29T06:00:00Z'), 'yearly').toISOString()).toBe('2029-02-28T06:00:00.000Z')
  })
})

describe('mandateExpiry', () => {
  it('ends a week after the last cycle', () => {
    expect(mandateExpiry(d('2026-11-10T00:00:00Z'), 'monthly', 3).toISOString()).toBe('2027-02-17T00:00:00.000Z')
  })
  it('falls back to the interval cap when open-ended', () => {
    expect(mandateExpiry(d('2026-11-10T00:00:00Z'), 'yearly', null).getUTCFullYear()).toBe(2036)
  })
})

describe('cyclePeriod', () => {
  it('starts the first cycle at the payment', () => {
    const p = cyclePeriod('monthly', null, d('2026-11-10T06:00:00Z'))
    expect(p.start.toISOString()).toBe('2026-11-10T06:00:00.000Z')
    expect(p.end.toISOString()).toBe('2026-12-10T06:00:00.000Z')
  })
  it('keeps the due date when a renewal is paid within the retry window', () => {
    const p = cyclePeriod('monthly', d('2026-12-10T06:00:00Z'), d('2026-12-11T09:00:00Z'))
    expect(p.start.toISOString()).toBe('2026-12-10T06:00:00.000Z')
    expect(p.end.toISOString()).toBe('2027-01-10T06:00:00.000Z')
  })
  it('restarts the period when the renewal is paid days late', () => {
    const p = cyclePeriod('monthly', d('2026-12-10T06:00:00Z'), d('2026-12-20T06:00:00Z'))
    expect(p.start.toISOString()).toBe('2026-12-20T06:00:00.000Z')
  })
})

describe('nextRenewalStep', () => {
  const due = d('2026-12-10T06:00:00Z')
  it('waits until the notice lead', () => {
    expect(nextRenewalStep(sub(), new Date(due.getTime() - NOTIFY_LEAD_MS - 1))).toEqual({ kind: 'wait' })
  })
  it('notifies the next cycle from the lead onwards, at least 24 h ahead of the due date', () => {
    expect(NOTIFY_LEAD_MS).toBeGreaterThan(MIN_NOTICE_MS)
    expect(nextRenewalStep(sub(), new Date(due.getTime() - NOTIFY_LEAD_MS))).toEqual({ kind: 'notify', cycle: 2, dueAt: due })
    expect(nextRenewalStep(sub({ current_cycle: 4 }), new Date(due.getTime() + H))).toEqual({ kind: 'notify', cycle: 5, dueAt: due })
  })
  it('does nothing for a subscription that is not active or whose mandate is not', () => {
    for (const status of ['created', 'paused', 'halted', 'cancelled', 'completed']) expect(nextRenewalStep(sub({ status }), due).kind).toBe('wait')
    for (const m of ['PAUSED', 'REVOKED', 'CANCELLED', 'ACTIVATION_IN_PROGRESS']) expect(nextRenewalStep(sub({ phonepe_mandate_state: m }), due).kind).toBe('wait')
  })
  it('ends a cycle-end cancel at the due date, never notifying', () => {
    expect(nextRenewalStep(sub({ cancel_at_cycle_end: true }), new Date(due.getTime() - H))).toEqual({ kind: 'wait' })
    expect(nextRenewalStep(sub({ cancel_at_cycle_end: true }), due)).toEqual({ kind: 'end', as: 'cancelled' })
  })
  it('completes a fixed term after its last paid cycle', () => {
    const s = sub({ current_cycle: 3, total_count: 3 })
    expect(nextRenewalStep(s, new Date(due.getTime() - H))).toEqual({ kind: 'wait' })
    expect(nextRenewalStep(s, due)).toEqual({ kind: 'end', as: 'completed' })
    expect(nextRenewalStep(sub({ current_cycle: 2, total_count: 3 }), due).kind).toBe('notify')
  })
})

describe('executeAfter', () => {
  const due = d('2026-12-10T06:00:00Z')
  it('is the due date when notified in time', () => {
    expect(executeAfter(due, new Date(due.getTime() - 30 * H))).toEqual(due)
  })
  it('never falls inside the 24 h notice', () => {
    const notified = new Date(due.getTime() - 2 * H)
    expect(executeAfter(due, notified).getTime()).toBe(notified.getTime() + MIN_NOTICE_MS)
  })
  it("honours PhonePe's validAfter", () => {
    const validAfter = new Date(due.getTime() + 5 * H)
    expect(executeAfter(due, new Date(due.getTime() - 30 * H), validAfter)).toEqual(validAfter)
  })
  it('keeps the order open two days past the first possible debit', () => {
    const now = new Date(due.getTime() - 30 * H)
    expect(redemptionExpiry(due, now).getTime()).toBe(due.getTime() + 48 * H)
    const late = new Date(due.getTime() + H)
    expect(redemptionExpiry(due, late).getTime()).toBe(late.getTime() + 72 * H)
  })
})

describe('redemptionStep', () => {
  const now = d('2026-12-10T06:00:00Z')
  it('polls while PhonePe is working', () => {
    expect(redemptionStep({ status: 'notifying', execute_after: null }, now)).toBe('poll')
    expect(redemptionStep({ status: 'executing', execute_after: now }, now)).toBe('poll')
  })
  it('executes a notified redemption only once its time has come', () => {
    expect(redemptionStep({ status: 'notified', execute_after: new Date(now.getTime() + 1) }, now)).toBe('wait')
    expect(redemptionStep({ status: 'notified', execute_after: now }, now)).toBe('execute')
    expect(redemptionStep({ status: 'notified', execute_after: null }, now)).toBe('wait')
  })
  it('leaves finished redemptions alone', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) expect(redemptionStep({ status, execute_after: now }, now)).toBe('done')
  })
})

describe('statusForMandateState', () => {
  it('maps PhonePe mandate states', () => {
    expect(statusForMandateState('ACTIVE')).toBe('active')
    expect(statusForMandateState('paused')).toBe('paused')
    expect(statusForMandateState('REVOKED')).toBe('cancelled')
    expect(statusForMandateState('CANCELLED')).toBe('cancelled')
    expect(statusForMandateState('EXPIRED')).toBe('expired')
    for (const s of ['ACTIVATION_IN_PROGRESS', 'PAUSE_IN_PROGRESS', 'CANCEL_IN_PROGRESS', '', null]) expect(statusForMandateState(s)).toBeNull()
  })
})
