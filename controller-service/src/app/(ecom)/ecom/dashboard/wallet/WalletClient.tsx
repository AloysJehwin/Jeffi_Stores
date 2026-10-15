'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '../_components/Card'
import { STATUS_PILL, fmt, fmtDate } from '../_components/finance'
import Pager from '../_components/Pager'
import { topupAmounts } from '@/lib/billing/topup-amounts'

interface Entry { entry_type: string; category: string | null; amount: number; note: string | null; occurred_at: string }

const AMOUNTS = [500, 1000, 2500, 5000]

export default function WalletClient({ initial, keyId, tenantName }: { initial: { balance: number; ledger: Entry[] }; keyId: string; tenantName: string }) {
  const router = useRouter()
  const [amount, setAmount] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  async function topUp() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/ecom/wallet/topup/create-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountInr: amount }) })
      const o = await r.json()
      if (!r.ok) throw new Error(o.error)
      if (!(window as any).Razorpay) await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('Checkout failed to load')); document.body.appendChild(s) })
      await new Promise<void>((res, rej) => {
        const rz = new (window as any).Razorpay({
          key: o.keyId || keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: 'Jeffi Commerce', description: `Wallet top-up · ${tenantName}`, theme: { color: '#c46a46' },
          handler: async (p: any) => {
            const v = await fetch('/api/ecom/wallet/topup/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
            const d = await v.json(); if (!v.ok) return rej(new Error(d.error)); res()
          },
          modal: { ondismiss: () => rej(new Error('Payment cancelled')) },
        })
        rz.open()
      })
      setMsg(`Added ${fmt(amount)} to your wallet. The tax invoice is on its way to your email.`); router.refresh()
    } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }

  const spentToday = initial.ledger.filter(e => e.entry_type === 'debit' && new Date(e.occurred_at).toDateString() === new Date().toDateString()).reduce((a, e) => a + Math.abs(e.amount), 0)
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[['Balance', fmt(initial.balance), true], ['Spent today', fmt(spentToday)], ['Entries', String(initial.ledger.length)]].map(([l, v, a]) => (
          <div key={l as string} className="rounded-2xl org-sand p-5"><div className="text-xs text-foreground-muted uppercase tracking-widest mb-2">{l}</div><div className={`font-display font-black text-2xl lg:text-3xl tabular-nums ${a ? 'ecom-accent-text' : ''}`}>{v}</div></div>
        ))}
      </div>
      <Card title="Top up">
        <div className="flex flex-wrap items-center gap-3">
          {AMOUNTS.map(a => <button key={a} onClick={() => setAmount(a)} className={`rounded-full px-4 py-2 text-sm font-semibold ${amount === a ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover'}`}>{fmt(a)}</button>)}
          <input type="number" min={100} value={amount} onChange={e => setAmount(Number(e.target.value))} className="w-32 rounded-xl bg-surface-elevated px-3 py-2 text-sm" />
          <button onClick={topUp} disabled={busy || amount < 100} className="ecom-accent-bg rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Opening…' : 'Pay with Razorpay'}</button>
        </div>
        {amount >= 100 && (
          <p className="mt-3 text-xs tabular-nums text-foreground-muted">
            {fmt(amount)} credit + {fmt(topupAmounts(amount).gst)} GST (18%) = you pay <strong className="text-foreground">{fmt(topupAmounts(amount).total)}</strong>. A tax invoice is emailed after payment.
          </p>
        )}
        {msg && <p className="mt-3 text-sm text-foreground-secondary">{msg}</p>}
      </Card>
      <Card title="Ledger">
        <div className="-mx-6 -mb-6 overflow-x-auto"><table className="w-full text-sm min-w-[560px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Category', 'Amount', 'Note'].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border-default">{initial.ledger.slice((page - 1) * 20, page * 20).map((e, i) => <tr key={i}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(e.occurred_at)}</td><td className="px-6 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.amount >= 0 ? STATUS_PILL.captured : 'org-sand'}`}>{(e.category ?? e.entry_type).replace(/_/g, ' ')}</span></td><td className={`px-6 py-2.5 font-semibold tabular-nums ${e.amount >= 0 ? 'text-green-600' : ''}`}>{e.amount >= 0 ? '+' : '−'}{fmt(e.amount)}</td><td className="px-6 py-2.5 text-xs text-foreground-secondary">{e.note ?? '—'}</td></tr>)}</tbody></table></div>
      </Card>
      <Pager page={page} total={initial.ledger.length} onPage={setPage} />
    </div>
  )
}
