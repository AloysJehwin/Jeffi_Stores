'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

/**
 * Top-nav shipping-wallet balance. Rendered only for platform-Delhivery tenants (the layout gates
 * on that). Server passes the initial balance so there is no load flash; it re-reads on focus and
 * after a top-up elsewhere (the `wallet:changed` window event).
 */
export default function WalletBadge({
  initialBalance,
  initialMinBalance,
}: {
  initialBalance: number
  initialMinBalance: number
}) {
  const [balance, setBalance] = useState(initialBalance)
  const [minBalance, setMinBalance] = useState(initialMinBalance)

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const r = await fetch('/api/admin/financial/wallet/topup', { cache: 'no-store' })
        if (!r.ok) return
        const w = await r.json()
        if (!alive) return
        setBalance(Number(w.balance) || 0)
        setMinBalance(Number(w.minBalance) || 0)
      } catch {
        /* keep the last known balance */
      }
    }
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('wallet:changed', refresh as EventListener)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('wallet:changed', refresh as EventListener)
    }
  }, [])

  const low = balance < minBalance
  return (
    <Link
      href="/admin/wallet"
      title={low ? 'Shipping wallet is below its minimum — top up' : 'Shipping wallet balance'}
      className={`hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold transition-colors ${
        low
          ? 'bg-amber-400/90 text-amber-950 hover:bg-amber-300'
          : 'bg-white/15 text-white hover:bg-white/25'
      }`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 10h18M3 10a2 2 0 012-2h14a2 2 0 012 2M3 10v8a2 2 0 002 2h14a2 2 0 002-2v-8m-4 4h.01"
        />
      </svg>
      {inr(balance)}
    </Link>
  )
}
