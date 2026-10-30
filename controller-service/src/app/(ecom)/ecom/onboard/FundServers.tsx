'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { topupAmounts } from '@/lib/billing/topup-amounts'

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

// Step 2 of payment: the store's servers are prepaid from its wallet. Once the wallet holds the first
// days the store is built (startStoreIfReady, via the top-up verify).
export default function FundServers({
  slug,
  displayName,
  keyId,
  requiredInr,
  balance,
  dailyInr,
  days,
}: {
  slug: string
  displayName: string
  keyId: string
  requiredInr: number
  balance: number
  dailyInr: number
  days: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const need = Math.max(100, Math.ceil(requiredInr - balance))
  const a = topupAmounts(need)
  const q = `?tenant=${encodeURIComponent(slug)}`

  async function pay() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/ecom/wallet/topup/create-order${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountInr: need }) })
      const o = await r.json()
      if (!r.ok) throw new Error(o.error)
      if (!(window as any).Razorpay) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement('script')
          s.src = 'https://checkout.razorpay.com/v1/checkout.js'
          s.onload = () => res()
          s.onerror = () => rej(new Error('Checkout failed to load'))
          document.body.appendChild(s)
        })
      }
      await new Promise<void>((res, rej) => {
        const rz = new (window as any).Razorpay({
          key: o.keyId || keyId,
          amount: o.amount,
          currency: o.currency,
          order_id: o.orderId,
          name: 'Jeffi Commerce',
          description: `Servers for ${displayName}`,
          theme: { color: '#c46a46' },
          handler: async (p: any) => {
            const v = await fetch(`/api/ecom/wallet/topup/verify${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
            const d = await v.json()
            if (!v.ok) return rej(new Error(d.error))
            res()
          },
          modal: { ondismiss: () => rej(new Error('Payment cancelled')) },
        })
        rz.open()
      })
      router.refresh()
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg w-full rounded-2xl border border-border-default org-sand p-6 sm:p-8">
      <p className="text-xs uppercase tracking-widest text-foreground-muted">Step 2 of 2</p>
      <h1 className="text-lg font-bold org-brown mt-1">Fund your servers</h1>
      <p className="text-sm org-brown mt-2">
        Your plan is paid. {displayName}&apos;s servers are paid from its wallet, about {inr(dailyInr)} a day; add the first {days} days
        and we start building the store.
      </p>
      <dl className="mt-4 space-y-1 text-sm tabular-nums">
        <div className="flex justify-between"><dt>Wallet credit</dt><dd>{inr(a.credit)}</dd></div>
        <div className="flex justify-between"><dt>GST (18%)</dt><dd>{inr(a.gst)}</dd></div>
        <div className="flex justify-between font-semibold"><dt>You pay</dt><dd>{inr(a.total)}</dd></div>
      </dl>
      {balance > 0 && <p className="mt-2 text-xs text-foreground-muted">Already in the wallet: {inr(balance)}</p>}
      <button onClick={pay} disabled={busy} className="ecom-accent-bg mt-5 w-full rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
        {busy ? 'Opening…' : `Pay ${inr(a.total)} with Razorpay`}
      </button>
      {msg && <p className="mt-3 text-sm text-red-700">{msg}</p>}
    </div>
  )
}
