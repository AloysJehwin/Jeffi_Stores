'use client'

import { useMemo, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type LedgerEntry = {
  entry_type: 'recharge' | 'debit' | 'adjustment'
  category: string | null
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}
type Wallet = { balance: number; minBalance: number; currency: string; ledger: LedgerEntry[] }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const CATEGORY_LABEL: Record<string, string> = {
  shipping_forward: 'Shipping — forward',
  shipping_rvp: 'Shipping — return pickup',
  shipping_correction: 'Shipping — correction',
  shipping_cancel_credit: 'Shipping — cancelled (credit)',
  recharge: 'Recharge',
  goodwill_credit: 'Goodwill credit',
  campaign: 'Campaign',
  ai: 'AI',
  adjustment: 'Adjustment',
}
// Fall back to entry_type when category is null (pre-category rows).
const catOf = (e: LedgerEntry) => e.category || e.entry_type
const catLabel = (c: string) => CATEGORY_LABEL[c] || c

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && (window as any).Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export default function WalletClient({ initial }: { initial: Wallet | null }) {
  const canWrite = useCanWrite('delhivery:write')
  const [wallet, setWallet] = useState<Wallet | null>(initial)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // filters
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all')
  const [cat, setCat] = useState<string>('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const ledger = useMemo(() => wallet?.ledger ?? [], [wallet])
  const categories = useMemo(() => [...new Set(ledger.map(catOf))].sort(), [ledger])

  const rows = useMemo(() => {
    return ledger.filter(e => {
      const amt = Number(e.amount)
      if (dir === 'in' && amt < 0) return false
      if (dir === 'out' && amt > 0) return false
      if (cat !== 'all' && catOf(e) !== cat) return false
      if (from && e.occurred_at.slice(0, 10) < from) return false
      if (to && e.occurred_at.slice(0, 10) > to) return false
      if (q) {
        const hay = `${e.order_ref ?? ''} ${e.awb ?? ''} ${e.note ?? ''}`.toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
  }, [ledger, dir, cat, q, from, to])

  async function refresh() {
    try {
      const r = await fetch('/api/admin/financial/wallet/topup', { cache: 'no-store' })
      if (r.ok) setWallet(await r.json())
      window.dispatchEvent(new Event('wallet:changed'))
    } catch {
      /* keep current */
    }
  }

  async function topUp() {
    const amountInr = Number(amount)
    if (!(amountInr > 0)) return setToast({ ok: false, text: 'Enter an amount greater than zero.' })
    setBusy(true)
    setToast(null)
    try {
      if (!(await loadRazorpayScript())) return setToast({ ok: false, text: 'Failed to load payment gateway.' })
      const res = await fetch('/api/admin/financial/wallet/topup/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountInr }),
      })
      const data = await res.json()
      if (!res.ok) return setToast({ ok: false, text: data.error || 'Failed to start top-up' })
      const rzp = new (window as any).Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: 'Wallet top-up',
        description: 'Delhivery shipping wallet',
        order_id: data.razorpayOrderId,
        handler: async (response: any) => {
          const vres = await fetch('/api/admin/financial/wallet/topup/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })
          if (!vres.ok) {
            setToast({ ok: false, text: `Paid, but crediting failed. Payment ID: ${response.razorpay_payment_id}` })
          } else {
            setToast({ ok: true, text: 'Wallet topped up.' })
            setAmount('')
            refresh()
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      })
      rzp.open()
    } catch {
      setToast({ ok: false, text: 'Network error' })
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    const head = ['Date', 'Category', 'Direction', 'Amount (INR)', 'Order', 'AWB', 'Note']
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = rows.map(e =>
      [
        new Date(e.occurred_at).toISOString(),
        catLabel(catOf(e)),
        Number(e.amount) >= 0 ? 'in' : 'out',
        Number(e.amount).toFixed(2),
        e.order_ref ?? '',
        e.awb ?? '',
        (e.note ?? '').replace(/\s+/g, ' '),
      ]
        .map(x => esc(String(x)))
        .join(',')
    )
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `wallet-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const balance = wallet?.balance ?? 0
  const low = balance < (wallet?.minBalance ?? 0)
  const inputCls =
    'h-9 px-3 rounded-lg border border-border-default bg-surface-elevated text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Shipping Wallet</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Prepaid balance the platform debits for Delhivery charges (forward, return pickups, and corrections).
        </p>
      </div>

      {/* Balance + recharge */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 bg-surface-elevated border border-border-default rounded-xl p-5">
        <div className="flex-1">
          <p className="text-xs text-foreground-muted uppercase tracking-wide">Balance</p>
          <p className={`text-3xl font-bold ${low ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
            {inr(balance)}
          </p>
          {low && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Below the minimum of {inr(wallet?.minBalance ?? 0)} — top up to keep shipping.
            </p>
          )}
        </div>
        {canWrite && (
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-foreground-muted mb-1">Amount (₹)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="2000"
                className={`${inputCls} w-32`}
              />
            </div>
            <button
              onClick={topUp}
              disabled={busy}
              className="h-9 px-4 rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {busy ? '…' : 'Top up'}
            </button>
          </div>
        )}
      </div>
      {toast && (
        <p className={`text-sm ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {toast.text}
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Direction</label>
          <select value={dir} onChange={e => setDir(e.target.value as any)} className={inputCls}>
            <option value="all">All</option>
            <option value="in">In (credits)</option>
            <option value="out">Out (debits)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">Category</label>
          <select value={cat} onChange={e => setCat(e.target.value)} className={inputCls}>
            <option value="all">All</option>
            {categories.map(c => (
              <option key={c} value={c}>
                {catLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-foreground-muted mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs text-foreground-muted mb-1">Search order / AWB / note</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="JS-123, AWB…" className={`${inputCls} w-full`} />
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="h-9 px-4 rounded-lg border border-border-default text-sm font-medium text-foreground hover:bg-surface-secondary disabled:opacity-50 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Ledger */}
      <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-foreground-muted uppercase tracking-wide border-b border-border-default">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5">Reference</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-foreground-muted">
                  No matching entries.
                </td>
              </tr>
            ) : (
              rows.map((e, i) => {
                const amt = Number(e.amount)
                return (
                  <tr key={i} className="border-b border-border-default last:border-0">
                    <td className="px-4 py-2.5 text-foreground-secondary whitespace-nowrap">
                      {new Date(e.occurred_at).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-surface-secondary text-foreground-secondary">
                        {catLabel(catOf(e))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-foreground-secondary">
                      {e.order_ref && <span className="mr-2">{e.order_ref}</span>}
                      {e.awb && <span className="text-foreground-muted">{e.awb}</span>}
                      {e.note && <span className="block text-xs text-foreground-muted">{e.note}</span>}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                        amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'
                      }`}
                    >
                      {amt >= 0 ? '+' : '−'}
                      {inr(Math.abs(amt))}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">Showing the most recent {ledger.length} entries.</p>
    </div>
  )
}
