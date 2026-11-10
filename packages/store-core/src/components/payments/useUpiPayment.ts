'use client'

import { useCallback, useState } from 'react'

// Browser side of a UPI payment (docs/plans/UPI_AND_MESSAGING_ADDON.md §1.5–1.6). `start` creates the
// intent; PhonePe mode leaves for the hosted page, UPG mode (docs/plans/UPI_UPG_V2.md) for our own
// checkout page /pay/upi/[id]; both pages poll the intent until it settles.

export type UpiPurpose = 'order_draft' | 'order' | 'order_adjustment' | 'variant_change' | 'wallet_topup' | 'ecom_wallet_topup'

export interface UpiStartBody {
  purpose: UpiPurpose
  draftToken?: string
  orderId?: string
  adjustmentId?: string
  requestId?: string
  amountInr?: number
  returnTo?: string
}

export interface UpiManualInfo {
  vpa: string
  payeeName: string
  upiUri: string
  qrDataUrl: string
  reference: string
}

export interface UpiStartResponse {
  intentId: string
  mode: 'phonepe' | 'upg' | 'manual'
  amountPaise: number
  redirectUrl?: string
  /** UPG: the host's /pay/upi/[id] page. */
  checkoutUrl?: string
  manual?: UpiManualInfo
}

export interface UpiManualState extends UpiManualInfo {
  intentId: string
  amountPaise: number
}

export type UpiIntentStatus =
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

export interface UpiIntentView {
  status: UpiIntentStatus
  purpose: UpiPurpose
  result?: { orderId?: string; orderNumber?: string; balance?: number } | null
  returnTo?: string | null
  amountPaise?: number
  provider?: 'phonepe' | 'upg'
  // UPG sessions (GET …/[id], docs/plans/UPI_UPG_V2.md §4)
  queuePosition?: number | null
  payExpiresAt?: string | null
  verifyExpiresAt?: string | null
  serverNow?: string | null
  payee?: { vpa: string; name: string } | null
  /** Only while active / processing. */
  upiUri?: string | null
  qrDataUrl?: string | null
}

const PENDING_KEY = 'upi_pending'

export interface PendingUpi {
  intentId: string
  returnTo?: string
  purpose: UpiPurpose
  amountPaise?: number
  ts: number
}

/** The intent this browser left to pay, if any (30 min). */
export function readPendingUpi(): PendingUpi | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingUpi
    if (!p?.intentId || Date.now() - (p.ts || 0) > 1800_000) {
      sessionStorage.removeItem(PENDING_KEY)
      return null
    }
    return p
  } catch {
    return null
  }
}

export function clearPendingUpi() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {}
}

/** Default return page; hosts with a path prefix (business, admin) pass their own builder. */
export const defaultUpiReturnPath = (intentId: string) => `/pay/upi/${encodeURIComponent(intentId)}/return`

/** The checkout page is always on this host: keep the path, drop any origin the server put on it. */
function sameOriginUrl(url: string): string | null {
  try {
    const u = new URL(url, window.location.origin)
    return u.pathname.startsWith('/') && !u.pathname.startsWith('//') ? u.pathname + u.search + u.hash : null
  } catch {
    return null
  }
}

export interface UseUpiPaymentOptions {
  /** Where the return page sends the customer after a successful payment. */
  returnTo?: string
  /** Extra request headers (the business portal's X-Auth-Portal). */
  headers?: Record<string, string>
  /** Builds the return page path for an intent; defaults to /pay/upi/[id]/return. */
  returnPath?: (intentId: string) => string
  /** Where start / confirm live; wallet top-ups use their own (admin and ecom hosts route /api/payments to the storefront). */
  apiBase?: string
}

export const UPI_API_BASE = '/api/payments/upi'

export interface UseUpiPayment {
  /** Creates the intent, then leaves for the PhonePe page or our UPI checkout page (the promise never settles in practice). */
  start: (body: UpiStartBody) => Promise<UpiStartResponse | null>
  busy: boolean
  error: string | null
  clearError: () => void
  /** Legacy pay-and-enter-UTR dialog; the server no longer returns it. */
  manual: UpiManualState | null
  /** Records the UTR; then goes to the return page, which reports "awaiting confirmation". */
  confirmUtr: (utr: string) => Promise<boolean>
  dismissManual: () => void
}

export function useUpiPayment(opts: UseUpiPaymentOptions = {}): UseUpiPayment {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState<UpiManualState | null>(null)
  const { returnTo, headers, returnPath, apiBase = UPI_API_BASE } = opts

  const start = useCallback(
    async (body: UpiStartBody) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`${apiBase}/start`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ returnTo, ...body }),
        })
        const data = (await res.json().catch(() => ({}))) as UpiStartResponse & { error?: string }
        if (!res.ok) throw new Error(data.error || 'Could not start the UPI payment')
        const pending: PendingUpi = { intentId: data.intentId, returnTo: body.returnTo ?? returnTo, purpose: body.purpose, amountPaise: data.amountPaise, ts: Date.now() }
        try {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
        } catch {}
        if (data.mode === 'phonepe') {
          if (!data.redirectUrl) throw new Error('The payment page is unavailable right now')
          window.location.href = data.redirectUrl
          return data // stays busy while the browser leaves
        }
        if (data.mode === 'upg') {
          // No URL from the server: the checkout page sits one level above the return page.
          const url = sameOriginUrl(data.checkoutUrl || (returnPath ?? defaultUpiReturnPath)(data.intentId).replace(/\/return$/, ''))
          if (!url) throw new Error('The payment page is unavailable right now')
          window.location.href = url
          return data
        }
        if (!data.manual) throw new Error('UPI details are unavailable right now')
        setManual({ ...data.manual, intentId: data.intentId, amountPaise: data.amountPaise })
        setBusy(false)
        return data
      } catch (e: any) {
        setError(e?.message || 'Could not start the UPI payment')
        setBusy(false)
        return null
      }
    },
    [returnTo, headers, apiBase, returnPath]
  )

  const confirmUtr = useCallback(
    async (utr: string) => {
      if (!manual) return false
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`${apiBase}/${encodeURIComponent(manual.intentId)}/confirm`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: JSON.stringify({ utr: utr.trim() }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || 'Could not record the payment')
        window.location.href = (returnPath ?? defaultUpiReturnPath)(manual.intentId)
        return true
      } catch (e: any) {
        setError(e?.message || 'Could not record the payment')
        setBusy(false)
        return false
      }
    },
    [manual, headers, returnPath, apiBase]
  )

  const dismissManual = useCallback(() => {
    setManual(null)
    setBusy(false)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { start, busy, error, clearError, manual, confirmUtr, dismissManual }
}

/** `flags.upiEnabled` from StoreConfig / SiteControls; tolerant of the flag not being typed yet. */
export function upiFlag(flags: object | null | undefined): boolean {
  return (flags as { upiEnabled?: boolean } | null | undefined)?.upiEnabled === true
}
