'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { Card, StatTile } from '../_components/Card'
import { EmptyState } from '../_components/EmptyState'
import { ChoiceChips, fieldCls } from '../../_ui'
import { primaryBtn } from '../../onboard/ui'
import { STATUS_PILL, fmt, fmtDate, fmtWhole, walletEntryLabel, walletEntryNote } from '../_components/finance'
import Pager from '../_components/Pager'
import { topupAmounts } from '@/lib/billing/topup-amounts'
import { PaymentSections, UpiManualDialog, razorpayDisplayConfig, useUpiPayment, type PaymentChoice } from '@/components/payments'

interface Entry { entry_type: string; category: string | null; amount: number; note: string | null; occurred_at: string }

const AMOUNTS = [500, 1000, 2500, 5000]
const MIN_TOPUP = 100
const legend = 'mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted'
const fmtDay = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function WalletClient({ initial, keyId, tenantName, upiEnabled = false }: { initial: { balance: number; ledger: Entry[] }; keyId: string; tenantName: string; upiEnabled?: boolean }) {
  const router = useRouter()
  const [amount, setAmount] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [method, setMethod] = useState<PaymentChoice>(upiEnabled ? 'upi' : 'razorpay')
  const upi = useUpiPayment({ returnTo: '/dashboard/wallet', apiBase: '/api/ecom/wallet/topup/upi' })
  const viaUpi = upiEnabled && method === 'upi'

  async function topUp() {
    if (viaUpi) {
      setMsg(null)
      await upi.start({ purpose: 'ecom_wallet_topup', amountInr: amount })
      return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/ecom/wallet/topup/create-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountInr: amount }) })
      const o = await r.json()
      if (!r.ok) throw new Error(o.error)
      if (!(window as any).Razorpay) await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('Checkout failed to load')); document.body.appendChild(s) })
      await new Promise<void>((res, rej) => {
        const rz = new (window as any).Razorpay({
          key: o.keyId || keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: 'Jeffi Commerce', description: `Wallet top-up · ${tenantName}`, theme: { color: '#c46a46' },
          ...(upiEnabled && { config: razorpayDisplayConfig({ hideUpi: true }) }),
          handler: async (p: any) => {
            const v = await fetch('/api/ecom/wallet/topup/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
            const d = await v.json(); if (!v.ok) return rej(new Error(d.error)); res()
          },
          modal: { ondismiss: () => rej(new Error('Payment cancelled')) },
        })
        rz.open()
      })
      setMsg(`Added ${fmtWhole(amount)} to your wallet. The tax invoice is on its way to your email.`); router.refresh()
    } catch (e: any) { setMsg(e.message) } finally { setBusy(false) }
  }

  const spentToday = initial.ledger.filter(e => e.entry_type === 'debit' && new Date(e.occurred_at).toDateString() === new Date().toDateString()).reduce((a, e) => a + Math.abs(e.amount), 0)
  const lastTopUp = initial.ledger.find(e => e.entry_type === 'recharge')
  const valid = amount >= MIN_TOPUP
  const due = topupAmounts(amount)
  const rows = initial.ledger.slice((page - 1) * 20, page * 20)
  const sign = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(n)}`
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <StatTile label="Balance" value={fmt(initial.balance)} accent />
        <StatTile label="Spent today" value={fmt(spentToday)} />
        <StatTile
          label="Last top-up"
          value={lastTopUp ? <>{fmtWhole(lastTopUp.amount)}<span className="mt-1 block font-sans text-xs font-normal text-foreground-muted">{fmtDay(lastTopUp.occurred_at)}</span></> : '—'}
        />
      </div>
      <Card title="Top up">
        <div className="space-y-5">
          <div>
            <p className={legend}>Amount</p>
            <div className="flex flex-wrap items-center gap-3">
              <ChoiceChips size="md" ariaLabel="Top-up amount" value={String(amount)} onChange={v => setAmount(Number(v))}
                options={AMOUNTS.map(a => ({ value: String(a), label: fmtWhole(a) }))} />
              <input type="number" min={MIN_TOPUP} value={amount} onChange={e => setAmount(Number(e.target.value))} aria-label="Custom amount" className={`w-32 rounded-xl bg-surface-elevated px-3 py-2 text-sm ${fieldCls}`} />
            </div>
            {!valid && <p className="mt-2 text-xs text-foreground-muted">The minimum top-up is {fmtWhole(MIN_TOPUP)}.</p>}
          </div>
          {upiEnabled && (
            <div className="max-w-md">
              <PaymentSections compact upi razorpay value={method} onChange={setMethod} />
            </div>
          )}
          <div className="flex flex-col gap-3 border-t border-border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
            {valid && (
              <p className="text-xs tabular-nums text-foreground-muted">
                {fmtWhole(amount)} credit + {fmtWhole(due.gst)} GST (18%) = you pay <strong className="text-foreground">{fmtWhole(due.total)}</strong>. A tax invoice is emailed after payment.
              </p>
            )}
            <button onClick={topUp} disabled={busy || upi.busy || !valid} className={`${primaryBtn} w-full shrink-0 sm:ml-auto sm:w-auto`}>
              {busy || upi.busy ? 'Opening…' : valid ? `Pay ${fmtWhole(due.total)}` : 'Pay'}
            </button>
          </div>
        </div>
        {msg && <p className="mt-3 text-sm text-foreground-secondary">{msg}</p>}
        {upi.error && !upi.manual && <p role="alert" className="mt-3 text-sm text-foreground-secondary">{upi.error}</p>}
        <UpiManualDialog manual={upi.manual} busy={upi.busy} error={upi.error} onConfirm={upi.confirmUtr} onClose={upi.dismissManual} />
      </Card>
      <Card title="Wallet activity">
        {rows.length === 0 ? (
          <EmptyState bare icon={Wallet} title="No wallet activity yet" action={{ href: '/dashboard/services', label: 'Browse services' }}>
            Top-ups and charges for messages, documents and shipping show here.
          </EmptyState>
        ) : (
          <>
            <ul className="-mx-6 -mb-6 divide-y divide-border-default border-t border-border-default sm:hidden">
              {rows.map((e, i) => {
                const note = walletEntryNote(e)
                return (
                  <li key={i} className="flex items-start justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{walletEntryLabel(e)}</p>
                      <p className="text-xs text-foreground-muted break-words">{fmtDate(e.occurred_at)}{note && ` · ${note}`}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${e.amount >= 0 ? 'text-green-600' : 'text-foreground'}`}>{sign(e.amount)}</span>
                  </li>
                )
              })}
            </ul>
            <div className="-mx-6 -mb-6 hidden overflow-x-auto sm:block">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="org-sand text-foreground-secondary">
                  <tr>{['Date', 'Type', 'Note', 'Amount'].map(h => <th key={h} className={`px-6 py-2 text-xs font-semibold ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {rows.map((e, i) => (
                    <tr key={i}>
                      <td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(e.occurred_at)}</td>
                      <td className="px-6 py-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.amount >= 0 ? STATUS_PILL.captured : 'org-sand'}`}>{walletEntryLabel(e)}</span></td>
                      <td className="px-6 py-2.5 text-xs text-foreground-secondary">{walletEntryNote(e) ?? '—'}</td>
                      <td className={`px-6 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${e.amount >= 0 ? 'text-green-600' : ''}`}>{sign(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <Pager page={page} total={initial.ledger.length} onPage={setPage} />
    </div>
  )
}
