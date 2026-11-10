/**
 * UPG session rules (docs/plans/UPI_UPG_V2.md §2), pure so they can be tested: one payer per UPI ID,
 * FIFO queue, server-side timers, and which intent a bank alert pays. The SQL in upg.ts mirrors these.
 */

export const upgPaySeconds = () => Math.max(30, Number(process.env.UPG_PAY_SECONDS) || 300)
export const upgVerifySeconds = () => Math.max(5, Number(process.env.UPG_VERIFY_SECONDS) || 30)
export const LATE_ALERT_MS = 15 * 60 * 1000

export interface UpgSlot {
  id: string
  status: string
  amount_paise: number
  receiving_vpa: string | null
  created_at: string | Date
  active_at?: string | Date | null
  pay_expires_at?: string | Date | null
  verify_expires_at?: string | Date | null
}

const ms = (v: string | Date | null | undefined) => (v ? new Date(v).getTime() : NaN)
export const UPG_OPEN = ['queued', 'active', 'processing']
const HOLDS_SLOT = ['active', 'processing']

/** The timer transition due for an intent at `now`: active past its pay window, processing past its check. */
export function dueTransition(i: UpgSlot, now: number): 'expired' | 'failed' | null {
  if (i.status === 'active' && ms(i.pay_expires_at) <= now) return 'expired'
  if (i.status === 'processing' && ms(i.verify_expires_at) <= now) return 'failed'
  return null
}

const fifo = (a: UpgSlot, b: UpgSlot) => ms(a.created_at) - ms(b.created_at) || (a.id < b.id ? -1 : 1)

/** The queued intent to activate on a UPI ID, or null while someone holds the slot. */
export function pickPromotion(intents: UpgSlot[], vpa: string): string | null {
  const mine = intents.filter(i => i.receiving_vpa === vpa)
  if (mine.some(i => HOLDS_SLOT.includes(i.status))) return null
  return mine.filter(i => i.status === 'queued').sort(fifo)[0]?.id ?? null
}

/** 1 + queued intents ahead on the same UPI ID; null when the intent is not queued. */
export function queuePosition(intents: UpgSlot[], id: string): number | null {
  const me = intents.find(i => i.id === id)
  if (!me || me.status !== 'queued') return null
  return 1 + intents.filter(i => i.id !== id && i.status === 'queued' && i.receiving_vpa === me.receiving_vpa && fifo(i, me) < 0).length
}

/** Applies due timers then one promotion; returns the intents as they stand at `now`. */
export function advance(intents: UpgSlot[], vpa: string, now: number): UpgSlot[] {
  const out = intents.map(i => {
    const to = i.receiving_vpa === vpa ? dueTransition(i, now) : null
    return to ? { ...i, status: to } : i
  })
  const next = pickPromotion(out, vpa)
  return out.map(i => (i.id === next ? { ...i, status: 'active', active_at: new Date(now), pay_expires_at: new Date(now + upgPaySeconds() * 1000) } : i))
}

export interface AlertFacts {
  receiving_vpa: string
  amount_paise: number
  /** When the alert was observed (email arrival). */
  observed_at: number
}

/**
 * The intent a credit alert pays: the one active/processing on that UPI ID when the amount is exactly
 * equal; else (forwarding lag) the latest failed/expired one of that amount that ended within 15
 * minutes, provided no other intent of that amount is open or was shown to a payer after it.
 */
export function matchAlert(a: AlertFacts, intents: UpgSlot[]): { intentId: string; late: boolean } | null {
  const mine = intents.filter(i => i.receiving_vpa === a.receiving_vpa)
  const live = mine.find(i => HOLDS_SLOT.includes(i.status))
  if (live && live.amount_paise === a.amount_paise) return { intentId: live.id, late: false }

  const same = mine.filter(i => i.amount_paise === a.amount_paise)
  if (same.some(i => UPG_OPEN.includes(i.status))) return null
  const endedAt = (i: UpgSlot) => (i.status === 'failed' ? ms(i.verify_expires_at) : ms(i.pay_expires_at))
  const late = same
    .filter(i => (i.status === 'failed' || i.status === 'expired') && a.observed_at - endedAt(i) <= LATE_ALERT_MS && ms(i.active_at) <= a.observed_at)
    .sort((x, y) => ms(y.active_at) - ms(x.active_at))[0]
  if (!late) return null
  // Someone else was shown this amount after the candidate: can't tell whose money it is.
  if (same.some(i => i.id !== late.id && ms(i.active_at) > ms(late.active_at))) return null
  return { intentId: late.id, late: true }
}
