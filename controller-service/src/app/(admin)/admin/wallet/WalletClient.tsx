'use client'

import { useMemo, useState } from 'react'
import { topupAmounts } from '@/lib/billing/topup-amounts'
import { aiFeatureLabel, aiLedgerNote } from '@/lib/ai/feature-labels'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { Banner, Card, DataTable, EmptyState, FormButton, FormField, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton, badgeCls, fieldInputCls, useActionToast, type DataCol } from '@/components/admin/kit'

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
export type AiSpendRow = { feature: string; calls: number; spent: number; unpaid: number }

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
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
  media: 'Media',
  adjustment: 'Adjustment',
}
const catOf = (e: LedgerEntry) => e.category || e.entry_type
const catLabel = (c: string) => CATEGORY_LABEL[c] || c
const noteOf = (e: LedgerEntry) => (e.category === 'ai' ? aiLedgerNote(e.note) : e.note)

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

export default function WalletClient({
  initial,
  aiSpend = [],
  aiSpendDays = 30,
}: {
  initial: Wallet | null
  aiSpend?: AiSpendRow[]
  aiSpendDays?: number
}) {
  const canWrite = useCanWrite('delhivery:write')
  const [wallet, setWallet] = useState<Wallet | null>(initial)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()
  // Top-up responses are toasts; same call sites, no banner.
  const setToast = (t: { ok: boolean; text: string } | null) => t && toast.result(t)

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
        const hay = `${e.order_ref ?? ''} ${e.awb ?? ''} ${noteOf(e) ?? ''}`.toLowerCase()
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
        (noteOf(e) ?? '').replace(/\s+/g, ' '),
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

  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const cols: DataCol<LedgerEntry & { i: number }>[] = [
    { key: 'date', label: 'Date', render: e => <span className="whitespace-nowrap text-foreground-secondary">{when(e.occurred_at)}</span> },
    { key: 'cat', label: 'Category', render: e => <span className={badgeCls('muted')}>{catLabel(catOf(e))}</span> },
    {
      key: 'ref',
      label: 'Reference',
      render: e => (
        <span className="text-foreground-secondary">
          {e.order_ref && <span className="mr-2">{e.order_ref}</span>}
          {e.awb && <span className="text-foreground-muted">{e.awb}</span>}
          {e.note && <span className="block text-xs text-foreground-muted">{noteOf(e)}</span>}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      num: true,
      render: e => {
        const amt = Number(e.amount)
        return (
          <span className={`font-semibold ${amt >= 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
            {amt >= 0 ? '+' : '−'}
            {inr(Math.abs(amt))}
          </span>
        )
      },
    },
  ]

  return (
    <PageBody>
      <PageHeader
        title="Shipping Wallet"
        description="Prepaid balance the platform debits for Delhivery charges (forward shipments, return pickups, corrections), messaging and AI."
      />

      <KpiGrid>
        <Kpi label="Balance" value={inr(balance)} sub={low ? `below minimum ${inr(wallet?.minBalance ?? 0)}` : `minimum ${inr(wallet?.minBalance ?? 0)}`} highlight />
        <Kpi label="Credits (filtered)" value={inr(totals.credit)} sub="recharges + credits" />
        <Kpi label="Debits (filtered)" value={inr(totals.debit)} sub="shipping + charges" />
      </KpiGrid>

      {low && <Banner ok={false}>Balance is below the minimum. Shipments may be blocked.</Banner>}

      {canWrite && (
        <Card title="Top up">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <FormField label="Amount (₹)" htmlFor="wallet-topup">
                <input id="wallet-topup" type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="2000" className={fieldInputCls} />
              </FormField>
            </div>
            <FormButton type="button" onClick={topUp} pending={busy} pendingLabel="Processing…">
              Top up
            </FormButton>
            {Number(amount) > 0 && (
              <span className="pb-1.5 text-xs tabular-nums text-foreground-muted">
                ₹{Number(amount).toLocaleString('en-IN')} credit + ₹{topupAmounts(Number(amount)).gst.toLocaleString('en-IN')} GST (18%) = pay ₹{topupAmounts(Number(amount)).total.toLocaleString('en-IN')} · tax invoice emailed
              </span>
            )}
          </div>
        </Card>
      )}

      {aiSpend.length > 0 && <AiSpendSection rows={aiSpend} days={aiSpendDays} />}

      <Card title="Ledger" hint={`Showing the most recent ${ledger.length} entries.`} flush>
        <div className="flex flex-wrap items-end gap-3 px-5 pb-4">
          <div className="w-40">
            <AdminSelect label="Direction" value={dir} onChange={setDir} options={DIRECTION_OPTIONS} sm />
          </div>
          <div className="w-52">
            <AdminSelect label="Category" value={cat} onChange={setCat} options={categoryOptions} sm />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="From">
              <DatePicker className="w-36" value={from} onChange={setFrom} />
            </FormField>
            <FormField label="To">
              <DatePicker className="w-36" value={to} onChange={setTo} />
            </FormField>
          </div>
          <div className="min-w-[180px] flex-1">
            <FormField label="Search order / AWB / note" htmlFor="wallet-q">
              <input id="wallet-q" className={fieldInputCls} value={q} onChange={e => setQ(e.target.value)} placeholder="JS-123, AWB…" />
            </FormField>
          </div>
          <FormButton type="button" variant="secondary" onClick={exportCsv} disabled={rows.length === 0} className="w-full md:w-auto">
            Export CSV
          </FormButton>
        </div>
        {!wallet ? (
          <div className="px-5 pb-5">
            <TableSkeleton rows={6} cols={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState bare title="No matching entries." />
        ) : (
          <DataTable<LedgerEntry & { i: number }> bare rows={rows.map((e, i) => ({ ...e, i }))} cols={cols} rowKey={e => String(e.i)} />
        )}
      </Card>
    </PageBody>
  )
}

function AiSpendSection({ rows, days }: { rows: AiSpendRow[]; days: number }) {
  const total = rows.reduce((a, r) => a + r.spent, 0)
  const unpaid = rows.reduce((a, r) => a + r.unpaid, 0)
  const cols: DataCol<AiSpendRow>[] = [
    { key: 'feature', label: 'Feature', render: r => <span className="text-foreground">{aiFeatureLabel(r.feature)}</span> },
    { key: 'calls', label: 'Calls', num: true, render: r => <span className="text-foreground-secondary">{r.calls.toLocaleString('en-IN')}</span> },
    { key: 'spent', label: 'Spent', num: true, render: r => <span className="font-semibold text-foreground">{inr(r.spent)}</span> },
  ]
  return (
    <Card
      title={`AI spend, last ${days} days`}
      flush
      action={
        <p className="text-sm tabular-nums text-foreground-secondary">
          {inr(total)}
          {unpaid > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">{unpaid} unpaid calls</span>}
        </p>
      }
    >
      <DataTable<AiSpendRow> bare rows={rows} cols={cols} rowKey={r => r.feature} />
    </Card>
  )
}
