'use client'

import { useEffect, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type LedgerEntry = {
  entry_type: 'recharge' | 'debit' | 'adjustment'
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}

type Wallet = {
  balance: number
  minBalance: number
  currency: string
  ledger: LedgerEntry[]
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type ReconcileRow = { awb: string; billedAmount: number }

// Delhivery's billing export is a plain CSV. Find the AWB column and the final-charge column by
// header name (the panel labels vary), then pull those two per row. Anything unparseable is dropped.
function parseBillingCsv(text: string): ReconcileRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return []
  const split = (line: string) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const header = split(lines[0]).map((h) => h.toLowerCase())
  const awbCol = header.findIndex((h) => h.includes('waybill') || h.includes('awb'))
  const amtCol = header.findIndex((h) => h.includes('total') || h.includes('charged amount') || h.includes('amount') || h.includes('billed'))
  if (awbCol < 0 || amtCol < 0) return []
  const rows: ReconcileRow[] = []
  for (const line of lines.slice(1)) {
    const cells = split(line)
    const awb = (cells[awbCol] || '').trim()
    const billedAmount = Number((cells[amtCol] || '').replace(/[^0-9.\-]/g, ''))
    if (awb && Number.isFinite(billedAmount) && billedAmount >= 0) rows.push({ awb, billedAmount })
  }
  return rows
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).Razorpay) return resolve(true)
    if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      resolve(true); return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function WalletCard() {
  const canWrite = useCanWrite('delhivery')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [period, setPeriod] = useState('')
  const [reconciling, setReconciling] = useState(false)
  const [reconcileSummary, setReconcileSummary] = useState<Record<string, number> | null>(null)

  const load = () => {
    fetch('/api/admin/financial/wallet/topup')
      .then(r => r.json())
      .then(d => { if (d && typeof d.balance === 'number') setWallet(d) })
      .catch(() => {})
  }
  useEffect(() => { load() }, [])

  const low = wallet != null && wallet.balance < wallet.minBalance

  const topUp = async () => {
    const amountInr = Number(amount)
    if (!(amountInr > 0)) { setToast({ ok: false, text: 'Enter an amount greater than zero.' }); return }
    setBusy(true); setToast(null)
    try {
      const ok = await loadRazorpayScript()
      if (!ok) { setToast({ ok: false, text: 'Failed to load payment gateway.' }); return }

      const res = await fetch('/api/admin/financial/wallet/topup/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountInr }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Failed to start top-up' }); return }

      const rzp = new (window as any).Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: 'Wallet top-up',
        description: 'Delhivery shipping wallet',
        order_id: data.razorpayOrderId,
        handler: async (response: any) => {
          const vres = await fetch('/api/admin/financial/wallet/topup/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          })
          const vdata = await vres.json()
          if (!vres.ok) {
            setToast({ ok: false, text: `Paid, but crediting failed. Payment ID: ${response.razorpay_payment_id}` })
          } else {
            setToast({ ok: true, text: 'Wallet topped up.' }); setAmount(''); load()
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

  const reconcile = async (file: File) => {
    if (!period.trim()) { setToast({ ok: false, text: 'Enter the billing period (e.g. 2026-08) first.' }); return }
    setReconciling(true); setToast(null); setReconcileSummary(null)
    try {
      const rows = parseBillingCsv(await file.text())
      if (rows.length === 0) {
        setToast({ ok: false, text: 'No AWB / charge rows found. Check the CSV has waybill and amount columns.' })
        return
      }
      const res = await fetch('/api/admin/delhivery/reconcile-billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: period.trim(), rows }),
      })
      const data = await res.json()
      if (!res.ok) { setToast({ ok: false, text: data.error || 'Reconciliation failed' }); return }
      setReconcileSummary(data.summary || {})
      setToast({ ok: true, text: `Reconciled ${rows.length} row${rows.length !== 1 ? 's' : ''} for ${data.period}.` })
      load()
    } catch {
      setToast({ ok: false, text: 'Could not read or upload the CSV.' })
    } finally {
      setReconciling(false)
    }
  }

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default mb-6">
      <div className="px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">Delhivery Wallet</h2>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-secondary text-foreground-muted">
            Using platform token
          </span>
        </div>
        <p className="text-sm text-foreground-secondary">
          You ship on the platform&apos;s Delhivery account. Each shipment&apos;s actual Delhivery
          charge is deducted from this wallet by AWB — even when you offer free delivery to your
          customer — so your real shipping cost stays visible.
        </p>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-xs font-medium text-foreground-muted mb-1">Balance</div>
            <div className={`text-2xl font-bold ${low ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
              {wallet ? inr(wallet.balance) : '—'}
            </div>
          </div>
          {wallet != null && wallet.minBalance > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground-muted mb-1">Minimum</div>
              <div className="text-sm text-foreground-secondary">{inr(wallet.minBalance)}</div>
            </div>
          )}
        </div>

        {low && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-4 py-2.5 text-sm">
            Balance is below the minimum. Shipments may be blocked until you top up.
          </div>
        )}

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="1" inputMode="numeric"
              placeholder="Amount in ₹"
              className="w-40 text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-foreground" />
            <button type="button" onClick={topUp} disabled={busy}
              className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors">
              {busy ? 'Processing…' : 'Top up'}
            </button>
          </div>
        )}

        {toast && (
          <div className={`rounded-lg border px-4 py-2.5 text-sm ${toast.ok
            ? 'border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
            : 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}>
            {toast.text}
          </div>
        )}

        {wallet != null && wallet.ledger.length > 0 && (
          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary/60 text-foreground-muted">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Date</th>
                  <th className="text-left font-medium px-4 py-2">Type</th>
                  <th className="text-left font-medium px-4 py-2">AWB</th>
                  <th className="text-right font-medium px-4 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {wallet.ledger.map((e, i) => {
                  const amt = Number(e.amount)
                  return (
                    <tr key={i} className="border-t border-border-default">
                      <td className="px-4 py-2 text-foreground-secondary">{new Date(e.occurred_at).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2 capitalize text-foreground-secondary">{e.entry_type}</td>
                      <td className="px-4 py-2 font-mono text-xs text-foreground-secondary">{e.awb || '—'}</td>
                      <td className={`px-4 py-2 text-right font-medium ${amt < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                        {amt < 0 ? '−' : '+'}{inr(Math.abs(amt))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {canWrite && (
          <div className="rounded-xl border border-border-default bg-surface-secondary/40 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Reconcile against Delhivery billing</h3>
              <p className="text-xs text-foreground-secondary mt-0.5">
                Delhivery re-weighs parcels at the hub, so the deducted estimate can differ from the
                final bill. Upload the monthly billing CSV to post an adjustment per AWB for the
                difference. Re-uploading the same period is safe — already-adjusted AWBs are skipped.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={period} onChange={e => setPeriod(e.target.value)} type="text"
                placeholder="Billing period e.g. 2026-08"
                className="w-48 text-sm rounded-lg border border-border-default bg-surface-elevated px-3 py-2 text-foreground" />
              <label className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${reconciling || !period.trim()
                ? 'bg-surface-secondary text-foreground-muted pointer-events-none opacity-50'
                : 'bg-accent-600 hover:bg-accent-700 text-white'}`}>
                {reconciling ? 'Reconciling…' : 'Upload billing CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" disabled={reconciling || !period.trim()}
                  onChange={e => { const f = e.target.files?.[0]; if (f) reconcile(f); e.target.value = '' }} />
              </label>
            </div>
            {reconcileSummary && (
              <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
                {Object.entries(reconcileSummary).map(([k, v]) => (
                  <span key={k} className="capitalize"><span className="font-medium text-foreground">{v}</span> {k}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
