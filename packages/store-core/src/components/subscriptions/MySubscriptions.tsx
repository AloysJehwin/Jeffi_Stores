'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { bp } from '@/lib/shared/business-path'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'
import { formatInr } from './SubscribeOption'

export interface SubscriptionItem {
  id: string
  status: string
  statusLabel: string
  productId: string
  productName: string
  productSlug: string
  imageUrl: string | null
  isDigital: boolean
  interval: string
  intervalLabel: string
  quantity: number
  amount: number
  currentCycle?: number
  totalCycles?: number | null
  minCycles?: number | null
  currentEnd: string | null
  nextChargeAt: string | null
  cancelAtCycleEnd: boolean
  accessExpiresAt: string | null
  address: { name: string; line1: string; city: string; state: string; pincode: string } | null
  orders: Array<{ id: string; orderNumber: string; status: string; total: number; createdAt: string; cycle: number }>
}

type Action = 'cancel' | 'pause' | 'resume' | 'address'

const STATUS_TONE: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  authenticated: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  created: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  halted: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}
const ENDED = new Set(['cancelled', 'completed', 'expired'])

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export function MySubscriptions({ isBusiness }: { isBusiness: boolean }) {
  const { user, isLoading } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const portalHeader: Record<string, string> = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
  const p = (path: string) => (isBusiness ? bp(`/business${path}`) : path)

  const [subs, setSubs] = useState<SubscriptionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [addressFor, setAddressFor] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Array<{ id: string; full_name: string; city: string; postal_code: string }>>(
    []
  )

  useEffect(() => {
    if (!isLoading && !user) {
      const redirect = '/account/subscriptions'
      router.push(isBusiness ? bp(`/business/signin?redirect=${redirect}`) : `/login?redirect=${redirect}`)
      return
    }
    if (!user) return
    fetch('/api/user/subscriptions', { credentials: 'include', headers: { ...portalHeader } })
      .then(r => (r.ok ? r.json() : { subscriptions: [] }))
      .then(d => setSubs(d.subscriptions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user, isLoading])

  const run = async (id: string, action: Action, addressId?: string) => {
    setBusy(id)
    try {
      const r = await fetch(`/api/user/subscriptions/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        body: JSON.stringify(addressId ? { action, addressId } : { action }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Could not update the subscription')
      setSubs(prev => prev.map(s => (s.id === id ? data.subscription : s)))
      setAddressFor(null)
      showToast('Subscription updated', 'success')
    } catch (e: any) {
      showToast(e?.message || 'Could not update the subscription', 'error')
    } finally {
      setBusy(null)
    }
  }

  const ask = async (s: SubscriptionItem, action: Exclude<Action, 'address'>) => {
    const copy = {
      cancel: {
        title: 'Cancel subscription?',
        message: `It will stop renewing. You keep ${s.isDigital ? 'access' : 'deliveries'} until ${fmtDate(s.currentEnd)}.`,
        confirmLabel: 'Cancel subscription',
        variant: 'danger' as const,
      },
      pause: { title: 'Pause subscription?', message: 'No further charges until you resume.', confirmLabel: 'Pause' },
      resume: { title: 'Resume subscription?', message: 'Charges restart from the next cycle.', confirmLabel: 'Resume' },
    }[action]
    if (await confirm(copy)) run(s.id, action)
  }

  const openAddress = async (id: string) => {
    setAddressFor(id)
    if (addresses.length) return
    const r = await fetch('/api/user/addresses', { credentials: 'include', headers: { ...portalHeader } }).catch(
      () => null
    )
    if (r?.ok) setAddresses((await r.json()).addresses ?? [])
  }

  const changeAddress = async (id: string, addressId: string) => {
    const ok = await confirm({
      title: 'Change delivery address?',
      message: 'Future cycles will ship to the selected address.',
      confirmLabel: 'Change address',
    })
    if (ok) run(id, 'address', addressId)
  }

  if (isLoading || !user) return null

  const btn =
    'px-3 py-1.5 rounded-lg text-sm font-medium border border-border-secondary hover:bg-surface-secondary disabled:opacity-50'

  return (
    <div className="bg-surface min-h-screen">
      {isBusiness ? <BusinessAccountMobileHeader /> : <AccountMobileHeader />}
      <div className="container mx-auto px-4 pt-4 pb-8 space-y-4">
        {loading ? (
          <div className="h-32 bg-surface-elevated rounded-lg border border-border-default animate-pulse" />
        ) : subs.length === 0 ? (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center">
            <p className="text-foreground-secondary mb-3">You have no subscriptions yet.</p>
            <Link href={isBusiness ? bp('/business') : '/'} className="text-accent-600 font-medium">
              Browse products
            </Link>
          </div>
        ) : (
          subs.map(s => {
            const ended = ENDED.has(s.status)
            const canCancel = !ended && !s.cancelAtCycleEnd && s.status !== 'created'
            const canPause = s.status === 'active' && !s.cancelAtCycleEnd
            const canResume = s.status === 'paused'
            const canAddress = !s.isDigital && !ended
            const paid = s.currentCycle ?? 0
            const locked = !!s.minCycles && paid < s.minCycles
            return (
              <article
                key={s.id}
                data-testid={`subscription-${s.id}`}
                className="bg-surface-elevated rounded-lg border border-border-default p-4 space-y-3"
              >
                <div className="flex gap-3 items-start">
                  {s.imageUrl && <img src={s.imageUrl} alt="" className="w-16 h-16 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={p(`/products/${s.productSlug}`)} className="font-semibold text-foreground truncate">
                        {s.productName}
                      </Link>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          STATUS_TONE[s.status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {s.statusLabel}
                      </span>
                      {s.cancelAtCycleEnd && !ended && (
                        <span className="text-xs text-foreground-muted">Ends {fmtDate(s.currentEnd)}</span>
                      )}
                    </div>
                    <p className="text-sm text-foreground-secondary">
                      {formatInr(s.amount)} · {s.intervalLabel}
                      {!s.isDigital && ` · Qty ${s.quantity}`}
                      {s.totalCycles ? ` · Cycle ${paid} of ${s.totalCycles}` : ''}
                    </p>
                    {!ended && !s.cancelAtCycleEnd && s.nextChargeAt && (
                      <p className="text-sm text-foreground-secondary">Next charge {fmtDate(s.nextChargeAt)}</p>
                    )}
                    {s.isDigital && s.accessExpiresAt && (
                      <p className="text-sm text-foreground-secondary">Access until {fmtDate(s.accessExpiresAt)}</p>
                    )}
                    {s.address && (
                      <p className="text-xs text-foreground-muted">
                        {s.address.name}, {s.address.line1}, {s.address.city}, {s.address.state} {s.address.pincode}
                      </p>
                    )}
                  </div>
                </div>

                {!ended && (
                  <div className="flex flex-wrap gap-2">
                    {canPause && (
                      <button className={btn} disabled={busy === s.id || locked} onClick={() => ask(s, 'pause')}>
                        Pause
                      </button>
                    )}
                    {canResume && (
                      <button className={btn} disabled={busy === s.id} onClick={() => ask(s, 'resume')}>
                        Resume
                      </button>
                    )}
                    {canAddress && (
                      <button className={btn} disabled={busy === s.id} onClick={() => openAddress(s.id)}>
                        Change address
                      </button>
                    )}
                    {canCancel && (
                      <button
                        className={`${btn} text-red-600 dark:text-red-400`}
                        disabled={busy === s.id || locked}
                        onClick={() => ask(s, 'cancel')}
                      >
                        Cancel
                      </button>
                    )}
                    {locked && (canPause || canCancel) && (
                      <p className="basis-full text-xs text-foreground-muted" data-testid="subscription-commitment">
                        Minimum {s.minCycles} charges: you can cancel or pause after charge {s.minCycles} ({paid} paid
                        so far).
                      </p>
                    )}
                  </div>
                )}

                {addressFor === s.id && (
                  <div className="border border-border-default rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium text-foreground">Deliver future cycles to</p>
                    {addresses.length === 0 ? (
                      <p className="text-sm text-foreground-muted">
                        No saved addresses.{' '}
                        <Link href={p('/account/addresses')} className="text-accent-600">
                          Add one
                        </Link>
                      </p>
                    ) : (
                      addresses.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          disabled={busy === s.id}
                          onClick={() => changeAddress(s.id, a.id)}
                          className="block w-full text-left text-sm px-3 py-2 rounded hover:bg-surface-secondary"
                        >
                          {a.full_name} — {a.city} {a.postal_code}
                        </button>
                      ))
                    )}
                    <button type="button" className="text-sm text-foreground-muted" onClick={() => setAddressFor(null)}>
                      Close
                    </button>
                  </div>
                )}

                {s.orders.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-foreground-secondary">
                      Cycle orders ({s.orders.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {s.orders.map(o => (
                        <li key={o.id} className="flex justify-between gap-2">
                          <Link href={p(`/account/orders/${o.id}`)} className="text-accent-600">
                            Cycle {o.cycle} · {o.orderNumber}
                          </Link>
                          <span className="text-foreground-secondary">
                            {fmtDate(o.createdAt)} · {formatInr(o.total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}

export function MySubscriptionsVisitor() {
  return <MySubscriptions isBusiness={false} />
}

export function MySubscriptionsBusiness() {
  return <MySubscriptions isBusiness={true} />
}
