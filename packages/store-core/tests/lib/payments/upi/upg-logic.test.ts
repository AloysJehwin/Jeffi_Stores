import { describe, it, expect } from 'vitest'
import { advance, dueTransition, LATE_ALERT_MS, matchAlert, pickPromotion, queuePosition, type UpgSlot } from '@/lib/payments/upi/upg-logic'

const VPA = 'shop@okhdfc'
const T0 = Date.parse('2026-11-10T10:00:00Z')
const at = (sec: number) => new Date(T0 + sec * 1000)
const slot = (id: string, status: string, over: Partial<UpgSlot> = {}): UpgSlot => ({ id, status, amount_paise: 5000, receiving_vpa: VPA, created_at: at(0), ...over })

describe('timers', () => {
  it('expires an active intent after its pay window and fails a processing one after the check window', () => {
    const active = slot('a', 'active', { pay_expires_at: at(300) })
    expect(dueTransition(active, T0 + 299_000)).toBeNull()
    expect(dueTransition(active, T0 + 300_000)).toBe('expired')
    const processing = slot('p', 'processing', { pay_expires_at: at(300), verify_expires_at: at(330) })
    expect(dueTransition(processing, T0 + 320_000)).toBeNull()
    expect(dueTransition(processing, T0 + 331_000)).toBe('failed')
    expect(dueTransition(slot('q', 'queued'), T0 + 9e9)).toBeNull()
  })
})

describe('queue', () => {
  const q = [
    slot('a', 'active', { created_at: at(0), pay_expires_at: at(300) }),
    slot('c', 'queued', { created_at: at(20) }),
    slot('b', 'queued', { created_at: at(10) }),
    slot('x', 'queued', { created_at: at(5), receiving_vpa: 'other@ybl' }),
  ]
  it('holds one payer per UPI ID and promotes FIFO', () => {
    expect(pickPromotion(q, VPA)).toBeNull()
    expect(pickPromotion(q, 'other@ybl')).toBe('x')
    const done = q.map(i => (i.id === 'a' ? { ...i, status: 'completed' } : i))
    expect(pickPromotion(done, VPA)).toBe('b')
    expect(pickPromotion([slot('p', 'processing'), slot('b', 'queued')], VPA)).toBeNull()
    expect(pickPromotion([slot('f', 'failed'), slot('e', 'cancelled')], VPA)).toBeNull()
  })
  it('reports the position in line', () => {
    expect(queuePosition(q, 'b')).toBe(1)
    expect(queuePosition(q, 'c')).toBe(2)
    expect(queuePosition(q, 'x')).toBe(1)
    expect(queuePosition(q, 'a')).toBeNull()
  })
  it('advance applies the due timer then hands the UPI ID to the next in line', () => {
    const still = advance(q, VPA, T0 + 100_000)
    expect(still.find(i => i.id === 'a')!.status).toBe('active')
    expect(still.find(i => i.id === 'b')!.status).toBe('queued')
    const next = advance(q, VPA, T0 + 301_000)
    expect(next.find(i => i.id === 'a')!.status).toBe('expired')
    const b = next.find(i => i.id === 'b')!
    expect(b.status).toBe('active')
    expect(new Date(b.pay_expires_at as Date).getTime()).toBe(T0 + 301_000 + 300_000)
    expect(next.find(i => i.id === 'c')!.status).toBe('queued')
    expect(next.find(i => i.id === 'x')!.status).toBe('queued')
  })
})

describe('matchAlert', () => {
  const alert = (amount: number, sec: number) => ({ receiving_vpa: VPA, amount_paise: amount, observed_at: T0 + sec * 1000 })

  it('pays the intent holding the UPI ID when the amount is exactly equal', () => {
    expect(matchAlert(alert(5000, 60), [slot('a', 'active', { active_at: at(0) }), slot('b', 'queued')])).toEqual({ intentId: 'a', late: false })
    expect(matchAlert(alert(5000, 60), [slot('p', 'processing', { active_at: at(0) })])).toEqual({ intentId: 'p', late: false })
    expect(matchAlert(alert(5001, 60), [slot('a', 'active', { active_at: at(0) })])).toBeNull()
    expect(matchAlert(alert(5000, 60), [slot('a', 'active', { receiving_vpa: 'other@ybl', active_at: at(0) })])).toBeNull()
    // never a queued intent: its payer has not been shown the UPI ID yet
    expect(matchAlert(alert(5000, 60), [slot('b', 'queued')])).toBeNull()
  })

  it('late alert: completes a failed / expired intent of that amount within 15 minutes', () => {
    const failed = slot('f', 'failed', { active_at: at(0), pay_expires_at: at(300), verify_expires_at: at(150) })
    expect(matchAlert(alert(5000, 400), [failed])).toEqual({ intentId: 'f', late: true })
    const expired = slot('e', 'expired', { active_at: at(0), pay_expires_at: at(300) })
    expect(matchAlert(alert(5000, 300 + LATE_ALERT_MS / 1000), [expired])).toEqual({ intentId: 'e', late: true })
    expect(matchAlert(alert(5000, 301 + LATE_ALERT_MS / 1000), [expired])).toBeNull()
    expect(matchAlert(alert(4000, 400), [failed])).toBeNull()
    expect(matchAlert(alert(5000, 400), [slot('c', 'cancelled', { active_at: at(0), pay_expires_at: at(300) })])).toBeNull()
  })

  it('late alert: someone else paying a different amount does not block it', () => {
    const failed = slot('f', 'failed', { active_at: at(0), pay_expires_at: at(300), verify_expires_at: at(150) })
    const other = slot('o', 'active', { amount_paise: 9900, active_at: at(160), pay_expires_at: at(460) })
    expect(matchAlert(alert(5000, 200), [failed, other])).toEqual({ intentId: 'f', late: true })
    // and the live one still gets its own alert
    expect(matchAlert(alert(9900, 200), [failed, other])).toEqual({ intentId: 'o', late: false })
  })

  it('late alert: refuses when another intent of that amount is open or was shown later', () => {
    const failed = slot('f', 'failed', { active_at: at(0), pay_expires_at: at(300), verify_expires_at: at(150) })
    // the live intent of the same amount takes it
    expect(matchAlert(alert(5000, 200), [failed, slot('n', 'active', { active_at: at(160), pay_expires_at: at(460) })])).toEqual({ intentId: 'n', late: false })
    // a queued one of the same amount makes it ambiguous
    expect(matchAlert(alert(5000, 200), [failed, slot('q', 'queued', { created_at: at(170) })])).toBeNull()
    // two ended intents of the same amount: the later-shown one wins only if nothing followed it
    const later = slot('g', 'expired', { active_at: at(160), pay_expires_at: at(460) })
    expect(matchAlert(alert(5000, 500), [failed, later])).toEqual({ intentId: 'g', late: true })
    const cancelledAfter = slot('h', 'cancelled', { active_at: at(470), pay_expires_at: at(770) })
    expect(matchAlert(alert(5000, 500), [failed, later, cancelledAfter])).toBeNull()
  })
})
