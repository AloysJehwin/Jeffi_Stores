'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

export interface AdFreeState {
  active: boolean
  until: string | null
  renew: boolean
  priceInr: number
  balanceInr: number
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`

// Remove-ads add-on: stores show Google ads by default; this buys ad-free months from the wallet.
export default function AdFreeCard({ initial, tenantSlug }: { initial: AdFreeState; tenantSlug: string }) {
  const { showToast } = useToast()
  const [s, setS] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const short = s.balanceInr < s.priceInr

  async function act(action: 'buy' | 'renew_on' | 'renew_off') {
    setBusy(true)
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
      setS(data)
      if (action === 'buy') showToast(`Ads removed until ${fmtDate(data.until)}`, 'success')
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const btn =
    'px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-6">
      <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-4">Ads on your store</h2>
      {s.active && s.until ? (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-lg font-bold text-foreground">Ad-free until {fmtDate(s.until)}</div>
            <div className="text-sm text-foreground-muted mt-0.5">
              {s.renew
                ? `Renews automatically for ${inr(s.priceInr)} from your wallet.`
                : 'Auto-renew is off. Ads come back when this month ends.'}
            </div>
          </div>
          <button
            onClick={() => act(s.renew ? 'renew_off' : 'renew_on')}
            disabled={busy}
            className={`${btn} ml-auto border border-border-default text-foreground hover:bg-surface-secondary`}
          >
            {s.renew ? 'Turn off auto-renew' : 'Turn on auto-renew'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground-secondary">
            Your store shows Google ads. Remove them for{' '}
            <span className="font-semibold text-foreground">{inr(s.priceInr)} a month</span>, paid from your wallet
            (balance {inr(s.balanceInr)}). It renews monthly until you turn it off.
          </p>
          {short ? (
            <Link
              href={`/dashboard/wallet?tenant=${encodeURIComponent(tenantSlug)}`}
              className={`${btn} inline-block bg-accent-600 hover:bg-accent-700 text-white`}
            >
              Top up wallet
            </Link>
          ) : confirming ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground">
                Pay {inr(s.priceInr)} from your wallet now?
              </span>
              <button onClick={() => act('buy')} disabled={busy} className={`${btn} bg-accent-600 hover:bg-accent-700 text-white`}>
                {busy ? 'Paying…' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className={`${btn} border border-border-default text-foreground hover:bg-surface-secondary`}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className={`${btn} bg-accent-600 hover:bg-accent-700 text-white`}>
              Remove ads · {inr(s.priceInr)}/month
            </button>
          )}
        </div>
      )}
    </div>
  )
}
