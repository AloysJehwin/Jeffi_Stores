'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { bp } from '@/lib/shared/business-path'

// Where PhonePe sends the customer back after the UPI Autopay mandate page: polls the subscription until
// the mandate and the first payment are confirmed, then opens the first order.

const POLL_MS = 2500
const MAX_POLLS = 72

type Phase = 'checking' | 'done' | 'failed' | 'timeout'

export function SubscribeReturn({ isBusiness }: { isBusiness: boolean }) {
  const subId = useSearchParams().get('sub') || ''
  const p = (path: string) => (isBusiness ? bp(`/business${path}`) : path)
  const subscriptionsPath = p('/account/subscriptions')
  const [phase, setPhase] = useState<Phase>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!subId || phase !== 'checking') return
    let active = true
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const res = await fetch(`/api/subscriptions/autopay/${encodeURIComponent(subId)}`, {
          credentials: 'include',
          cache: 'no-store',
          headers: isBusiness ? { 'X-Auth-Portal': 'business' } : undefined,
        })
        const data = await res.json().catch(() => ({}))
        if (!active) return
        if (res.ok && data.setup === 'active') {
          setPhase('done')
          window.location.replace(data.orderId ? `${p('/account/orders')}/${data.orderId}` : subscriptionsPath)
          return
        }
        if ((res.ok && data.setup === 'failed') || res.status === 404) {
          setPhase('failed')
          return
        }
      } catch {}
      if (!active) return
      if (++polls >= MAX_POLLS) setPhase('timeout')
      else timer = setTimeout(poll, POLL_MS)
    }
    poll()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subId, phase, attempt])

  const btn = 'inline-flex h-10 items-center justify-center rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white hover:bg-accent-600'

  let icon = <Loader2 className="h-6 w-6 animate-spin text-accent-500" aria-hidden />
  let title = 'Confirming your UPI Autopay…'
  let body = 'We are checking the mandate with your bank. This usually takes a few seconds — please keep this page open.'
  let action: React.ReactNode = null
  if (!subId || phase === 'failed') {
    icon = <XCircle className="h-6 w-6 text-red-500" aria-hidden />
    title = 'Subscription not started'
    body = 'The UPI Autopay mandate was not approved, so nothing was charged. You can try again.'
    action = (
      <Link href={isBusiness ? bp('/business') : '/'} className={btn}>
        Continue shopping
      </Link>
    )
  } else if (phase === 'done') {
    icon = <CheckCircle2 className="h-6 w-6 text-green-600" aria-hidden />
    title = 'Subscription started'
    body = 'Taking you to your order.'
  } else if (phase === 'timeout') {
    icon = <CheckCircle2 className="h-6 w-6 text-foreground-muted" aria-hidden />
    title = 'Still waiting for the bank'
    body = 'Your mandate has not been confirmed yet. If you approved it, the subscription will start on its own; you can check again or look under My subscriptions later.'
    action = (
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => {
            setAttempt(a => a + 1)
            setPhase('checking')
          }}
        >
          Check again
        </button>
        <Link href={subscriptionsPath} className="inline-flex h-10 items-center justify-center rounded-lg border border-border-default px-4 text-sm font-medium text-foreground hover:bg-surface-secondary">
          My subscriptions
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-[70vh] bg-surface px-4 py-10 flex items-center justify-center">
      <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-border-default bg-surface-elevated p-6 text-center sm:p-8" role="status" aria-live="polite">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">{icon}</div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-foreground-secondary">{body}</p>
        {action}
      </div>
    </div>
  )
}

export function SubscribeReturnVisitor() {
  return (
    <Suspense fallback={null}>
      <SubscribeReturn isBusiness={false} />
    </Suspense>
  )
}

export function SubscribeReturnBusiness() {
  return (
    <Suspense fallback={null}>
      <SubscribeReturn isBusiness={true} />
    </Suspense>
  )
}
