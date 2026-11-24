'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'
import type { AdFreeState } from '@controller/lib/ecom/ad-free-state'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// Remove-ads add-on: stores show Google ads by default; ad-free is a line on the workspace's subscription.
export default function AdFreeCard({ initial, tenantSlug }: { initial: AdFreeState; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function act(action: 'add' | 'remove' | 'decline_request') {
    setBusy(true)
    let leaving = false
    try {
      const res = await fetch(`/api/ecom/billing/ad-free?tenant=${encodeURIComponent(tenantSlug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Could not update ads', 'error')
        return
      }
      if (data.checkoutUrl) {
        leaving = true
        showToast('Opening Razorpay to approve the payment…', 'info')
        window.location.href = data.checkoutUrl
        return
      }
      setS(data)
      if (action === 'add') showToast('Ad-free added to your subscription', 'success')
      if (action === 'remove') showToast(data.endsAt ? `Ad-free ends on ${fmtDate(data.endsAt)}` : 'Ad-free removed', 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      if (!leaving) setBusy(false)
      setConfirming(false)
    }
  }

  const btn = 'inline-block px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const primary = `${btn} bg-accent-600 hover:bg-accent-700 text-white`
  const ghost = `${btn} border border-border-default text-foreground hover:bg-surface-secondary`
  const price = `${inr(s.priceInr)}/month`

  const removeControl = confirming ? (
    <div className="ml-auto flex flex-wrap items-center gap-3">
      <span className="text-sm text-foreground">Remove ad-free? It stays on until the paid cycle ends.</span>
      <button onClick={() => act('remove')} disabled={busy} className={primary}>
        {busy ? 'Removing…' : 'Remove'}
      </button>
      <button onClick={() => setConfirming(false)} disabled={busy} className={ghost}>
        Keep it
      </button>
    </div>
  ) : (
    <button onClick={() => setConfirming(true)} disabled={busy} className={`${ghost} ml-auto`}>
      Remove
    </button>
  )

  let body
  if (s.lineStatus === 'awaiting_payment') {
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">Waiting for your approval</div>
          <div className="text-sm text-foreground-muted mt-0.5">
            Ad-free ({price}) is on your subscription. {s.checkoutUrl ? 'Approve the payment to switch it on.' : 'It switches on once the payment goes through.'}
          </div>
        </div>
        {s.checkoutUrl && (
          <a href={s.checkoutUrl} className={primary}>
            Approve payment
          </a>
        )}
        {removeControl}
      </div>
    )
  } else if (s.lineStatus === 'ending') {
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">{s.endsAt ? `Ad-free until ${fmtDate(s.endsAt)}` : 'Ad-free is ending'}</div>
          <div className="text-sm text-foreground-muted mt-0.5">Removed from your subscription. Ads come back when the paid cycle ends.</div>
        </div>
        <button onClick={() => act('add')} disabled={busy} className={`${primary} ml-auto`}>
          Keep ad-free · {price}
        </button>
      </div>
    )
  } else if (s.lineStatus === 'legacy_wallet') {
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">{s.until ? `Ad-free until ${fmtDate(s.until)}` : 'Ad-free'}</div>
          <div className="text-sm text-foreground-muted mt-0.5">Paid from your wallet. Move it to your subscription to keep ads off.</div>
        </div>
        <Link href={`/dashboard/billing/subscribe?tenant=${encodeURIComponent(tenantSlug)}`} className={`${primary} ml-auto`}>
          Set up subscription
        </Link>
      </div>
    )
  } else if (s.lineStatus === 'active' || s.lineStatus === 'trial') {
    body = (
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">Ad-free</div>
          <div className="text-sm text-foreground-muted mt-0.5">On your subscription · {price}.</div>
        </div>
        {removeControl}
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        {s.requested && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-foreground">You chose this during signup — add it to your subscription below to switch it on.</p>
            <button onClick={() => act('decline_request')} disabled={busy} className="text-sm font-medium text-foreground-muted hover:text-foreground disabled:opacity-50">
              Not now
            </button>
          </div>
        )}
        <p className="text-sm text-foreground-secondary">
          {s.active && s.until ? `Ad-free until ${fmtDate(s.until)}. ` : 'Your store shows Google ads. '}
          {s.active ? 'Add it to your subscription to keep ads off' : 'Remove them'} for <span className="font-semibold text-foreground">{inr(s.priceInr)} a month</span> on
          your subscription.
        </p>
        <button onClick={() => act('add')} disabled={busy} className={primary}>
          {busy ? 'Adding…' : `Add to subscription · ${price}`}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">Ads on your store</h2>
      {body}
    </div>
  )
}
