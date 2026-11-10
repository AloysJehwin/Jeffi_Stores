// UPI intents (docs/plans/UPI_UPG_V2.md §2, §4): a PhonePe redirect, or UPG — a queued, timed pay-to-UPI-ID session.

export type UpiPurpose = 'order_draft' | 'order'
export type UpiMode = 'phonepe' | 'upg'
/** PhonePe: pending → completed | failed | expired. UPG: queued → active → processing → completed, with the rest as fallbacks. */
export type UpiStatus =
  | 'pending'
  | 'queued'
  | 'active'
  | 'processing'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'rejected'

export interface UpiStartBody {
  purpose: UpiPurpose
  draftToken?: string
  orderId?: string
  returnTo?: string
  // UPG only.
  /** 1-based place in the line while `queued`. */
  queuePosition?: number
  payExpiresAt?: string | null
  verifyExpiresAt?: string | null
  /** The server's clock, to correct the countdowns for device skew. */
  serverNow?: string
  payee?: { vpa: string; name: string }
  /** `upi://pay?…` with everything filled in; only while `active` / `processing`. */
  upiUri?: string
  qrDataUrl?: string
}

export interface UpiStartResult {
  intentId: string
  mode: UpiMode
  amountPaise: number
  /** PhonePe: the payment page. */
  redirectUrl?: string
  /** UPG: the web checkout page (the app shows its own screen). */
  checkoutUrl?: string
}

export interface UpiStatusResult {
  status: UpiStatus
  purpose: UpiPurpose
  result?: { orderId: string; orderNumber: string }
  returnTo?: string
  // UPG only.
  /** 1-based place in the line while `queued`. */
  queuePosition?: number
  payExpiresAt?: string | null
  verifyExpiresAt?: string | null
  /** The server's clock, to correct the countdowns for device skew. */
  serverNow?: string
  payee?: { vpa: string; name: string }
  /** `upi://pay?…` with everything filled in; only while `active` / `processing`. */
  upiUri?: string
  qrDataUrl?: string
}
