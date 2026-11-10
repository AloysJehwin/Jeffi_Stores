import { api } from './client'
import type { UpiStartBody, UpiStartResult, UpiStatusResult } from '../types/upi'

export type { UpiMode, UpiPurpose, UpiStartBody, UpiStartResult, UpiStatus, UpiStatusResult } from '../types/upi'

/** Opens a UPI intent for a checkout draft or an unpaid order; the server works out the amount. */
export function startUpiPayment(body: UpiStartBody): Promise<UpiStartResult> {
  return api('/api/payments/upi/start', { method: 'POST', body: JSON.stringify(body) })
}

/** The intent's state (the server settles a pending PhonePe intent and advances a UPG session first). */
export function getUpiStatus(intentId: string): Promise<UpiStatusResult> {
  return api(`/api/payments/upi/${encodeURIComponent(intentId)}`)
}

const intentPath = (intentId: string, action: string) => `/api/payments/upi/${encodeURIComponent(intentId)}/${action}`

/** UPG: "Payment done — check my payment" (active → processing). */
export function checkUpiPayment(intentId: string): Promise<Partial<UpiStatusResult>> {
  return api(intentPath(intentId, 'check'), { method: 'POST' })
}

/** UPG: give up a queued / active session so the next payer can go. */
export function cancelUpiPayment(intentId: string): Promise<Partial<UpiStatusResult>> {
  return api(intentPath(intentId, 'cancel'), { method: 'POST' })
}

/** UPG: the customer's UTR after a failed / expired session, for the store to match. Read the state back with getUpiStatus. */
export function confirmUpiUtr(intentId: string, utr: string): Promise<Partial<UpiStatusResult> & { ok?: boolean }> {
  return api(intentPath(intentId, 'confirm'), { method: 'POST', body: JSON.stringify({ utr }) })
}
