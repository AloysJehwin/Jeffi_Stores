'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Clock, Copy, Download, Loader2, Users, XCircle } from 'lucide-react'
import { UpiMark } from './PaymentSections'
import { isValidUtr } from './UpiManualDialog'
import { clearPendingUpi, readPendingUpi, type UpiIntentStatus, type UpiIntentView, type UpiPurpose } from './useUpiPayment'

// Our own UPI checkout page (docs/plans/UPI_UPG_V2.md §5): queue → 5:00 pay window (QR / app buttons)
// → 30 s bank check → done, with the UTR fallback when no bank alert shows up. Polls the intent.

const POLL_MS = 2000
const SLOW_POLL_MS = 5000 // failed / expired: a late bank alert can still complete it
const AWAIT_POLL_MS = 10000
const SLOW_POLL_LIMIT_MS = 20 * 60_000

export interface UpiCheckoutClientProps {
  intentId: string
  /** Where a paid order goes; wins over the intent's `returnTo` when the result names an order. */
  orderHref?: (orderId: string, purpose: UpiPurpose) => string
  /** Where to go when the intent carries no `returnTo` (wallet page, orders list…). */
  fallbackHref: string
  /** "Try again" destination for a new checkout; defaults to the intent's `returnTo`, then `fallbackHref`. */
  retryHref?: string
  /** Extra request headers (business portal). */
  headers?: Record<string, string>
  /** Status / check / cancel / confirm base; see useUpiPayment's apiBase. */
  apiBase?: string
  /** Called once when the payment completed, before the redirect (e.g. clear the cart). */
  onCompleted?: (view: UpiIntentView) => void
}

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const btnPrimary = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50'
const btnGhost = 'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border-default px-4 text-sm font-medium text-foreground hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50'
const frame = 'mx-auto w-full max-w-md rounded-xl border border-border-default bg-surface-elevated'

/** Deep links that open a UPI app with the payment filled in, from the status `upiUri`. */
export function upiAppLinks(upiUri: string, ios: boolean): { key: string; label: string; href: string }[] {
  const i = upiUri.indexOf('?')
  const q = i >= 0 ? upiUri.slice(i + 1) : ''
  if (!q) return []
  return [
    { key: 'gpay', label: 'Google Pay', href: `${ios ? 'gpay' : 'tez'}://upi/pay?${q}` },
    { key: 'phonepe', label: 'PhonePe', href: `phonepe://pay?${q}` },
    { key: 'paytm', label: 'Paytm', href: `paytmmp://pay?${q}` },
    { key: 'other', label: 'Other UPI app', href: `upi://pay?${q}` },
  ]
}

const APP_DOT: Record<string, string> = { gpay: 'bg-blue-500', phonepe: 'bg-purple-600', paytm: 'bg-sky-500', other: 'bg-green-600' }

const ANNOUNCE: Partial<Record<UpiIntentStatus, string>> = {
  queued: 'You are in line to pay.',
  active: 'It is your turn. You have five minutes to pay.',
  processing: 'Checking with your bank.',
  completed: 'Payment received.',
  failed: 'We could not see your payment yet.',
  expired: 'The payment window ran out.',
  cancelled: 'Payment cancelled.',
  awaiting_confirmation: 'Payment noted. The store will confirm it.',
  rejected: 'The payment could not be confirmed.',
}

export default function UpiCheckoutClient({ intentId, orderHref, fallbackHref, retryHref, headers, apiBase = '/api/payments/upi', onCompleted }: UpiCheckoutClientProps) {
  const [view, setView] = useState<UpiIntentView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'check' | 'cancel' | 'confirm' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [phone, setPhone] = useState<{ mobile: boolean; ios: boolean }>({ mobile: false, ios: false })
  const [copied, setCopied] = useState(false)
  const [utr, setUtr] = useState('')
  const [utrTouched, setUtrTouched] = useState(false)
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)
  const skew = useRef(0) // server clock − this clock
  const done = useRef(false)
  const uid = useId()

  const base = `${apiBase}/${encodeURIComponent(intentId)}`
  const status = view?.status ?? null

  useEffect(() => {
    const ua = navigator.userAgent || ''
    const ios = /iPhone|iPad|iPod/i.test(ua)
    setPhone({ mobile: ios || /Android/i.test(ua), ios })
    const p = readPendingUpi()
    if (p?.intentId === intentId && p.amountPaise) setPendingAmount(p.amountPaise)
  }, [intentId])

  const target = (v: UpiIntentView | null) => {
    const oid = v?.result?.orderId
    if (oid && orderHref) return orderHref(oid, v!.purpose)
    return v?.returnTo || fallbackHref
  }

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let fails = 0
    const started = Date.now()
    const poll = async () => {
      let next = POLL_MS
      try {
        const res = await fetch(base, { credentials: 'include', cache: 'no-store', headers })
        const data = (await res.json().catch(() => ({}))) as UpiIntentView & { error?: string }
        if (!alive) return
        if (!res.ok) {
          // Not ours / not found: nothing to wait for.
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            setLoadError(data.error || 'This payment could not be found.')
            return
          }
          throw new Error(data.error || `Could not check the payment (${res.status})`)
        }
        fails = 0
        setOffline(false)
        if (data.serverNow) {
          const t = Date.parse(data.serverNow)
          if (Number.isFinite(t)) skew.current = t - Date.now()
        }
        setNow(Date.now())
        setView(data)
        const s = data.status
        if (s === 'completed') {
          if (!done.current) {
            done.current = true
            clearPendingUpi()
            onCompleted?.(data)
          }
          window.location.replace(target(data))
          return
        }
        if (s === 'cancelled' || s === 'rejected') {
          clearPendingUpi()
          return
        }
        if (s === 'failed' || s === 'expired' || s === 'awaiting_confirmation') {
          if (Date.now() - started > SLOW_POLL_LIMIT_MS) return
          next = s === 'awaiting_confirmation' ? AWAIT_POLL_MS : SLOW_POLL_MS
        }
      } catch {
        if (!alive) return
        fails++
        if (fails >= 3) setOffline(true)
      }
      timer = setTimeout(poll, next)
    }
    poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, nonce])

  const ticking = status === 'active' || status === 'processing'
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [ticking])

  useEffect(() => {
    setCancelArmed(false)
    setActionError(null)
  }, [status])

  async function post(kind: 'check' | 'cancel' | 'confirm', body?: unknown) {
    setBusy(kind)
    setActionError(null)
    try {
      const res = await fetch(`${base}/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify(body ?? {}),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      setNonce(n => n + 1) // re-read at once
      return true
    } catch (e: any) {
      setActionError(e?.message || 'Something went wrong. Please try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const cancel = () => {
    if (!cancelArmed) return setCancelArmed(true)
    void post('cancel')
  }

  const submitUtr = (e: React.FormEvent) => {
    e.preventDefault()
    setUtrTouched(true)
    if (!isValidUtr(utr) || busy) return
    void post('confirm', { utr: utr.trim().toUpperCase() })
  }

  const copyVpa = async (vpa: string) => {
    try {
      await navigator.clipboard.writeText(vpa)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const amountPaise = view?.amountPaise ?? pendingAmount
  const amount = amountPaise ? inr(amountPaise) : null
  const dest = target(view)
  const again = view?.purpose && view.purpose !== 'order_draft' ? view.returnTo || retryHref || fallbackHref : retryHref ?? view?.returnTo ?? fallbackHref
  const orderNo = view?.result?.orderNumber
  const serverMs = now + skew.current

  const live = (
    <p className="sr-only" role="status" aria-live="polite">
      {status ? ANNOUNCE[status] ?? '' : ''}
    </p>
  )
  const errorNote = actionError && (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
      {actionError}
    </p>
  )
  const offlineNote = offline && <p className="text-xs text-amber-600 dark:text-amber-400">Connection lost — retrying…</p>

  if (loadError) {
    return (
      <Panel icon={<XCircle className="h-6 w-6 text-red-500" aria-hidden />} title="Payment not found">
        <p className="text-sm text-foreground-secondary">{loadError}</p>
        <Link href={fallbackHref} className={btnPrimary}>
          Continue
        </Link>
      </Panel>
    )
  }

  if (!view) return <UpiCheckoutLoading />

  if (status === 'completed' || status === 'pending') {
    return (
      <Panel icon={<Loader2 className="h-6 w-6 animate-spin text-accent-500" aria-hidden />} title={status === 'completed' ? 'Payment received' : 'Confirming your payment…'}>
        {live}
        <p className="text-sm text-foreground-secondary">{status === 'completed' ? 'Taking you back now.' : 'We are checking with your bank. This usually takes a few seconds — please keep this page open.'}</p>
        {offlineNote}
      </Panel>
    )
  }

  if (status === 'queued') {
    const pos = view.queuePosition && view.queuePosition > 0 ? view.queuePosition : null
    return (
      <Panel icon={<Users className="h-6 w-6 text-accent-500" aria-hidden />} title={pos ? `You're #${pos} in line` : "You're in line"}>
        {live}
        {amount && <p className="text-2xl font-bold tabular-nums text-foreground">{amount}</p>}
        <p className="text-sm text-foreground-secondary">
          Payments to this UPI ID are taken one at a time so yours is matched exactly. Your 5 minutes start when it&apos;s your turn — keep this page open.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-foreground-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Waiting for your turn…
        </div>
        {offlineNote}
        {errorNote}
        <button type="button" onClick={cancel} disabled={busy === 'cancel'} className={btnGhost}>
          {busy === 'cancel' ? 'Cancelling…' : cancelArmed ? 'Tap again to leave the line' : 'Cancel'}
        </button>
      </Panel>
    )
  }

  if (status === 'active') {
    const expires = view.payExpiresAt ? Date.parse(view.payExpiresAt) : NaN
    const left = Number.isFinite(expires) ? expires - serverMs : null
    const low = left !== null && left <= 60_000
    const links = view.upiUri ? upiAppLinks(view.upiUri, phone.ios) : []
    const vpa = view.payee?.vpa
    return (
      <div className={`${frame} sm:max-w-lg`}>
        {live}
        <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3 sm:px-6">
          <span className="flex min-w-0 items-center gap-2">
            <UpiMark className="h-6 w-auto shrink-0 text-foreground" />
            <h1 className="truncate text-sm font-semibold text-foreground">Pay with UPI</h1>
          </span>
          {left !== null && (
            <span
              role="timer"
              aria-label={`Time left to pay: ${clock(left)}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
                low ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-surface-secondary text-foreground'
              }`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {clock(left)}
            </span>
          )}
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="text-center">
            {amount && <p className="text-3xl font-bold tabular-nums text-foreground">{amount}</p>}
            <p className="mt-1 text-sm text-foreground-secondary">
              to <span className="font-medium text-foreground">{view.payee?.name || 'the store'}</span>
            </p>
            {vpa && (
              <p className="mt-1 flex items-center justify-center gap-2">
                <code className="min-w-0 break-all font-mono text-sm text-foreground">{vpa}</code>
                <button
                  type="button"
                  onClick={() => copyVpa(vpa)}
                  aria-label={copied ? 'Copied' : 'Copy UPI ID'}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-default text-foreground-secondary hover:bg-surface-secondary"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </p>
            )}
          </div>

          {view.qrDataUrl && (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={view.qrDataUrl}
                alt={`UPI QR code${amount ? ` for ${amount}` : ''}${vpa ? ` to ${vpa}` : ''}`}
                width={256}
                height={256}
                className="h-52 w-52 rounded-lg border border-border-default bg-white p-2 sm:h-64 sm:w-64"
              />
              {phone.mobile ? (
                <>
                  <a
                    href={view.qrDataUrl}
                    download={`upi-${(amountPaise ?? 0) / 100}.png`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-default px-3 text-sm font-medium text-foreground hover:bg-surface-secondary"
                  >
                    <Download className="h-4 w-4" aria-hidden /> Save QR
                  </a>
                  <p className="text-center text-xs text-foreground-muted">
                    Save the QR, then in your UPI app tap Scan and pick it from your gallery. Or pay to the UPI ID above. Don&apos;t change the amount.
                  </p>
                </>
              ) : (
                <p className="text-xs text-foreground-muted">Scan with any UPI app. The amount is filled in — please don&apos;t change it.</p>
              )}
            </div>
          )}

          {phone.mobile && links.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Or open your UPI app</p>
              <div className="grid grid-cols-2 gap-2">
                {links.map(l => (
                  <a
                    key={l.key}
                    href={l.href}
                    className="flex h-12 min-w-0 items-center gap-2 rounded-lg border border-border-default px-3 text-sm font-semibold text-foreground hover:border-accent-500 hover:bg-surface-secondary"
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${APP_DOT[l.key]}`} aria-hidden />
                    <span className="truncate">{l.label}</span>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-xs text-foreground-muted">If your app says the payment can&apos;t be completed, pay with the QR or the UPI ID instead.</p>
            </div>
          )}

          <p className="text-center text-xs text-foreground-muted">Pay the exact amount, then come back here. We confirm it automatically from the bank.</p>

          {offlineNote}
          {errorNote}

          <div className="space-y-2">
            <button type="button" onClick={() => post('check')} disabled={!!busy} className={btnPrimary}>
              {busy === 'check' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Payment done — check my payment
            </button>
            <button type="button" onClick={cancel} disabled={!!busy} className={btnGhost}>
              {busy === 'cancel' ? 'Cancelling…' : cancelArmed ? 'Tap again to cancel this payment' : 'Cancel'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'processing') {
    const expires = view.verifyExpiresAt ? Date.parse(view.verifyExpiresAt) : NaN
    const left = Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - serverMs) / 1000)) : null
    return (
      <Panel icon={<Loader2 className="h-6 w-6 animate-spin text-accent-500" aria-hidden />} title="Checking with your bank…">
        {live}
        {amount && <p className="text-2xl font-bold tabular-nums text-foreground">{amount}</p>}
        <p className="text-sm text-foreground-secondary">We are looking for your payment. Please keep this page open.</p>
        {left !== null && (
          <p role="timer" aria-label={`${left} seconds left`} className="text-sm font-semibold tabular-nums text-foreground">
            {left}s
          </p>
        )}
        {offlineNote}
      </Panel>
    )
  }

  if (status === 'awaiting_confirmation') {
    return (
      <Panel icon={<Clock className="h-6 w-6 text-amber-500" aria-hidden />} title="Payment noted">
        {live}
        <p className="text-sm text-foreground-secondary">
          Thanks — we have recorded your UTR{orderNo ? ` for order #${orderNo}` : ''}. The store will confirm the payment shortly and you will be notified.
        </p>
        <Link href={dest} className={btnPrimary}>
          {view.result?.orderId ? 'View order' : 'Continue'}
        </Link>
      </Panel>
    )
  }

  if (status === 'cancelled') {
    return (
      <Panel icon={<XCircle className="h-6 w-6 text-foreground-muted" aria-hidden />} title="Payment cancelled">
        {live}
        <p className="text-sm text-foreground-secondary">Nothing was charged. If you already paid from your UPI app, contact the store with your UTR.</p>
        <Link href={again} className={btnPrimary}>
          Try again
        </Link>
      </Panel>
    )
  }

  if (status === 'rejected') {
    return (
      <Panel icon={<XCircle className="h-6 w-6 text-red-500" aria-hidden />} title="Payment not confirmed">
        {live}
        <p className="text-sm text-foreground-secondary">The store could not match this payment. If money left your account, contact the store with your UTR.</p>
        <Link href={again} className={btnPrimary}>
          Try again
        </Link>
      </Panel>
    )
  }

  // failed / expired
  const utrOk = isValidUtr(utr)
  const canUtr = view.provider !== 'phonepe'
  return (
    <Panel icon={<XCircle className="h-6 w-6 text-amber-500" aria-hidden />} title={canUtr ? "We couldn't see your payment yet" : status === 'expired' ? 'Payment window expired' : 'Payment not completed'}>
      {live}
      <p className="text-sm text-foreground-secondary">
        {!canUtr
          ? 'This payment did not go through. Nothing has been charged — you can start again.'
          : status === 'expired'
            ? 'The 5 minutes ran out before we saw a payment. If you did pay, enter the UTR below and the store will confirm it. Otherwise start again.'
            : 'Bank confirmations can take a few minutes. If you paid, enter the UTR below and the store will confirm it; this page also updates by itself if the confirmation arrives.'}
      </p>
      {canUtr && (
        <form onSubmit={submitUtr} className="space-y-2 text-left">
          <label htmlFor={`${uid}-utr`} className="block text-sm font-medium text-foreground-secondary">
            UTR / transaction reference
          </label>
          <input
            id={`${uid}-utr`}
            value={utr}
            onChange={e => setUtr(e.target.value.replace(/\s+/g, ''))}
            onBlur={() => setUtrTouched(true)}
            autoComplete="off"
            inputMode="text"
            maxLength={22}
            placeholder="12-digit UTR from your UPI app"
            aria-invalid={utrTouched && !utrOk ? true : undefined}
            aria-describedby={`${uid}-utr-hint`}
            className="h-10 w-full rounded-lg border border-border-secondary bg-surface px-3 font-mono text-sm text-foreground placeholder:text-foreground-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <p id={`${uid}-utr-hint`} className={`text-xs ${utrTouched && !utrOk ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
            {utrTouched && !utrOk ? 'Enter the 12-digit UTR (or the 12–22 character transaction ID) shown in your UPI app.' : 'Found under the payment in your UPI app as UTR, RRN or transaction ID.'}
          </p>
          {errorNote}
          <button type="submit" disabled={!!busy || (utrTouched && !utrOk)} className={btnPrimary}>
            {busy === 'confirm' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy === 'confirm' ? 'Recording…' : 'I have paid — submit UTR'}
          </button>
        </form>
      )}
      <Link href={again} className={canUtr ? btnGhost : btnPrimary}>
        Try again
      </Link>
    </Panel>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={`${frame} space-y-4 p-4 text-center sm:p-8`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">{icon}</div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {children}
    </div>
  )
}

/** The checkout card's shape before the first status arrives; also the pages' loading.tsx. */
export function UpiCheckoutLoading() {
  const bar = 'animate-pulse rounded bg-surface-secondary'
  return (
    <div className={`${frame} sm:max-w-lg`} role="status" aria-busy="true" aria-label="Loading your payment">
      <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3 sm:px-6">
        <div className={`${bar} h-6 w-32`} />
        <div className={`${bar} h-7 w-16 rounded-full`} />
      </div>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col items-center gap-2">
          <div className={`${bar} h-9 w-36`} />
          <div className={`${bar} h-4 w-40`} />
          <div className={`${bar} h-4 w-48`} />
        </div>
        <div className={`${bar} mx-auto h-52 w-52 rounded-lg sm:h-64 sm:w-64`} />
        <div className={`${bar} mx-auto h-3 w-56`} />
        <div className="space-y-2">
          <div className={`${bar} h-11 w-full rounded-lg`} />
          <div className={`${bar} h-10 w-full rounded-lg`} />
        </div>
      </div>
    </div>
  )
}
