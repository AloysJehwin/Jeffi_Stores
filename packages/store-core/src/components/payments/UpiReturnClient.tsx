'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { clearPendingUpi, type UpiIntentStatus, type UpiIntentView, type UpiPurpose } from './useUpiPayment'

// The return page's body: polls the intent every 2 s for up to ~3 minutes, then redirects or explains.

const POLL_MS = 2000
const MAX_POLLS = 90

export interface UpiReturnClientProps {
  intentId: string
  /** Where a paid order goes; wins over the intent's `returnTo` when the result names an order. */
  orderHref?: (orderId: string, purpose: UpiPurpose) => string
  /** Where to go when the intent carries no `returnTo` (wallet page, orders list…). */
  fallbackHref: string
  /** "Try again" destination for failed / expired payments; defaults to `fallbackHref`. */
  retryHref?: string
  /** Extra request headers (business portal). */
  headers?: Record<string, string>
  /** Status endpoint base; see useUpiPayment's apiBase. */
  apiBase?: string
  /** Called once when the payment completed, before the redirect (e.g. clear the cart). */
  onCompleted?: (view: UpiIntentView) => void
}

type Phase = 'checking' | 'redirecting' | 'awaiting' | 'failed' | 'timeout' | 'error'

const FAILED: Record<string, { title: string; body: string }> = {
  failed: { title: 'Payment not completed', body: 'Your UPI app reported that the payment did not go through. Nothing has been charged.' },
  expired: { title: 'Payment window expired', body: 'This payment request timed out before it was paid. You can start again.' },
  rejected: { title: 'Payment not confirmed', body: 'The store could not match this payment. If money left your account, contact the store with your UTR.' },
}

export default function UpiReturnClient({ intentId, orderHref, fallbackHref, retryHref, headers, apiBase = '/api/payments/upi', onCompleted }: UpiReturnClientProps) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [status, setStatus] = useState<UpiIntentStatus | null>(null)
  const [view, setView] = useState<UpiIntentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const done = useRef(false)

  const target = (v: UpiIntentView | null) => {
    const oid = v?.result?.orderId
    if (oid && orderHref) return orderHref(oid, v!.purpose)
    return v?.returnTo || fallbackHref
  }

  useEffect(() => {
    if (phase !== 'checking') return
    let active = true
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/${encodeURIComponent(intentId)}`, { credentials: 'include', cache: 'no-store', headers })
        const data = (await res.json().catch(() => ({}))) as UpiIntentView & { error?: string }
        if (!active) return
        if (!res.ok) throw new Error(data.error || `Could not check the payment (${res.status})`)
        setView(data)
        setStatus(data.status)
        if (data.status === 'completed') {
          if (!done.current) {
            done.current = true
            clearPendingUpi()
            onCompleted?.(data)
          }
          setPhase('redirecting')
          window.location.replace(target(data))
          return
        }
        if (data.status === 'awaiting_confirmation') {
          clearPendingUpi()
          setPhase('awaiting')
          return
        }
        if (data.status === 'failed' || data.status === 'expired' || data.status === 'rejected') {
          clearPendingUpi()
          setPhase('failed')
          return
        }
        polls++
        if (polls >= MAX_POLLS) {
          setPhase('timeout')
          return
        }
        timer = setTimeout(poll, POLL_MS)
      } catch (e: any) {
        if (!active) return
        polls++
        if (polls >= MAX_POLLS) {
          setError(e?.message || 'Could not check the payment')
          setPhase('error')
          return
        }
        timer = setTimeout(poll, POLL_MS)
      }
    }
    poll()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, phase, attempt])

  const again = retryHref ?? fallbackHref
  const dest = target(view)
  const orderNo = view?.result?.orderNumber

  if (phase === 'checking' || phase === 'redirecting') {
    return (
      <Panel icon={<Loader2 className="h-6 w-6 animate-spin text-accent-500" aria-hidden />} title={phase === 'redirecting' ? 'Payment received' : 'Confirming your payment…'}>
        <p className="text-sm text-foreground-secondary">
          {phase === 'redirecting' ? 'Taking you back now.' : 'We are checking with your bank. This usually takes a few seconds — please keep this page open.'}
        </p>
      </Panel>
    )
  }

  if (phase === 'awaiting') {
    return (
      <Panel icon={<Clock className="h-6 w-6 text-amber-500" aria-hidden />} title="Payment noted">
        <p className="text-sm text-foreground-secondary">
          Thanks — we have recorded your UTR{orderNo ? ` for order #${orderNo}` : ''}. The store will confirm the payment shortly and you will be notified.
        </p>
        <Link href={dest} className="inline-flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600">
          {view?.result?.orderId ? 'View order' : 'Continue'}
        </Link>
      </Panel>
    )
  }

  if (phase === 'failed') {
    const f = FAILED[status ?? 'failed'] ?? FAILED.failed
    return (
      <Panel icon={<XCircle className="h-6 w-6 text-red-500" aria-hidden />} title={f.title}>
        <p className="text-sm text-foreground-secondary">{f.body}</p>
        <Link href={again} className="inline-flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600">
          Try again
        </Link>
      </Panel>
    )
  }

  return (
    <Panel icon={<CheckCircle2 className="h-6 w-6 text-foreground-muted" aria-hidden />} title="Still waiting for the bank">
      <p className="text-sm text-foreground-secondary">
        {error ?? 'Your payment has not been confirmed yet. If money left your account it will be matched automatically; you can check again or come back later.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null)
            setAttempt(a => a + 1)
            setPhase('checking')
          }}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600"
        >
          Check again
        </button>
        <Link href={dest} className="inline-flex h-10 items-center justify-center rounded-lg border border-border-default px-4 text-sm font-medium text-foreground hover:bg-surface-secondary">
          Continue
        </Link>
      </div>
    </Panel>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-border-default bg-surface-elevated p-6 text-center sm:p-8" role="status" aria-live="polite">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">{icon}</div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {children}
    </div>
  )
}

/** The same frame the pages show before the client mounts. */
export function UpiReturnLoading() {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-border-default bg-surface-elevated p-6 text-center sm:p-8" role="status" aria-busy="true">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
        <Loader2 className="h-6 w-6 animate-spin text-accent-500" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-foreground">Confirming your payment…</h1>
      <p className="text-sm text-foreground-secondary">We are checking with your bank. This usually takes a few seconds — please keep this page open.</p>
    </div>
  )
}
