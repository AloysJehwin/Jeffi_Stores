'use client'

import { useMemo, useState } from 'react'
import { topupAmounts } from '@/lib/billing/topup-amounts'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnSecondary,
  SummaryCard,
  Skeleton,
  thCls,
  thRight,
} from '@/app/(admin)/admin/financial/_components/shared'

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
const catOf = (e: LedgerEntry) => e.category || e.entry_type
const catLabel = (c: string) => CATEGORY_LABEL[c] || c

const DIRECTION_OPTIONS = [
  { value: 'all', label: 'All directions' },
  { value: 'in', label: 'In (credits)' },
  { value: 'out', label: 'Out (debits)' },
]

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
  const [dir, setDir] = useState('all')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const ledger = useMemo(() => wallet?.ledger ?? [], [wallet])
  const categoryOptions = useMemo(
    () => [{ value: 'all', label: 'All categories' }, ...[...new Set(ledger.map(catOf))].sort().map(c => ({ value: c, label: catLabel(c) }))],
    [ledger]
  )

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

  const totals = useMemo(() => {
    let credit = 0
    let debit = 0
    for (const e of rows) {
      const a = Number(e.amount)
      if (a >= 0) credit += a
      else debit += -a
    }
    return { credit, debit }
  }, [rows])

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
            setToast({ ok: true, text: `Added ₹${amountInr.toLocaleString('en-IN')} to the wallet. The tax invoice is on its way to your email.` })
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

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Shipping Wallet</h1>
        <p className="text-sm text-foreground-muted mt-1">
          Prepaid balance the platform debits for Delhivery charges — forward shipments, return pickups and corrections.
        </p>
      </div>

      {/* Summary cards (shared SummaryCard, same as Financial) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="Balance"
          value={inr(balance)}
          sub={low ? `below minimum ${inr(wallet?.minBalance ?? 0)}` : `minimum ${inr(wallet?.minBalance ?? 0)}`}
        />
        <SummaryCard label="Credits (filtered)" value={inr(totals.credit)} sub="recharges + credits" />
        <SummaryCard label="Debits (filtered)" value={inr(totals.debit)} sub="shipping + charges" />
      </div>

      {/* Recharge */}
      {canWrite && (
        <div className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-40">
              <label className={labelCls}>Top up amount (₹)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="2000"
                className={inputCls}
              />
            </div>
            <button className={btnPrimary} onClick={topUp} disabled={busy}>
              {busy ? 'Processing…' : 'Top up'}
            </button>
            {Number(amount) > 0 && (
              <span className="text-xs text-foreground-muted pb-1.5 tabular-nums">
                ₹{Number(amount).toLocaleString('en-IN')} credit + ₹{topupAmounts(Number(amount)).gst.toLocaleString('en-IN')} GST (18%) = pay ₹{topupAmounts(Number(amount)).total.toLocaleString('en-IN')} · tax invoice emailed
              </span>
            )}
            {low && <span className="text-xs text-amber-600 dark:text-amber-400 pb-1.5">Balance is below the minimum — shipments may be blocked.</span>}
          </div>
          {toast && (
            <p className={`text-sm mt-2 ${toast.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {toast.text}
            </p>
          )}
        </div>
      )}

      {/* Filter bar (shared AdminSelect + DatePicker, same as Financial Transactions) */}
      <div className="bg-surface-elevated rounded-xl border border-border-default px-4 py-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-40">
            <AdminSelect label="Direction" value={dir} onChange={setDir} options={DIRECTION_OPTIONS} sm />
          </div>
          <div className="w-52">
            <AdminSelect label="Category" value={cat} onChange={setCat} options={categoryOptions} sm />
          </div>
          <div>
            <label className={labelCls}>From</label>
            <DatePicker className="w-36" value={from} onChange={setFrom} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <DatePicker className="w-36" value={to} onChange={setTo} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className={labelCls}>Search order / AWB / note</label>
            <input className={inputCls} value={q} onChange={e => setQ(e.target.value)} placeholder="JS-123, AWB…" />
          </div>
          <div className="pb-0.5">
            <button className={btnSecondary} onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Ledger */}
      {!wallet ? (
        <Skeleton />
      ) : (
        <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border-default">
              <tr>
                <th className={thCls}>Date</th>
                <th className={thCls}>Category</th>
                <th className={thCls}>Reference</th>
                <th className={thRight}>Amount</th>
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
      )}
      <p className="text-xs text-foreground-muted">Showing the most recent {ledger.length} entries.</p>
    </div>
  )
}
