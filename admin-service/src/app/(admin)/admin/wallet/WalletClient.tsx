'use client'

import { useState } from 'react'
import { topupAmounts } from '@/lib/billing/topup-amounts'
import { aiFeatureLabel, aiLedgerNote } from '@/lib/ai/feature-labels'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, Card, DataTable, FormButton, FormField, Kpi, KpiGrid, ListFilters, PageBody, PageHeader, badgeCls, fetchJson, fieldInputCls, useActionToast, useFilterQuery, useInfiniteList, useListSort, type DataCol } from '@/components/admin/kit'
import { WALLET_FIELDS, WALLET_SEARCH } from '@/lib/filters/fields/wallet'

type LedgerEntry = {
  id: string
  entry_type: 'recharge' | 'debit' | 'adjustment'
  category: string | null
  amount: string
  order_ref: string | null
  awb: string | null
  note: string | null
  occurred_at: string
}
type Wallet = { balance: number; minBalance: number; currency: string }
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

const PAGE_SIZE = 50

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

  // The ledger's filters live in the URL and are applied on the server, 50 entries a page; the
  // credit / debit cards total every matching entry.
  const filters = useFilterQuery(WALLET_FIELDS)
  const [totals, setTotals] = useState({ credit: 0, debit: 0 })
  const ledgerSort = useListSort('ledger')
  const list = useInfiniteList<LedgerEntry>({
    key: `${filters}|${ledgerSort.sort ?? ''}|${ledgerSort.dir}`,
    pageSize: PAGE_SIZE,
    getKey: e => e.id,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams(filters)
      params.set('page', String(p))
      if (ledgerSort.sort) {
        params.set('sort', ledgerSort.sort)
        params.set('dir', ledgerSort.dir)
      }
      const data = await fetchJson(`/api/admin/financial/wallet/topup/ledger?${params}`, signal)
      if (p === 1) setTotals({ credit: Number(data.credit) || 0, debit: Number(data.debit) || 0 })
      return { rows: data.rows || [], total: data.total ?? 0 }
    },
  })

  async function refresh() {
    try {
      const r = await fetch('/api/admin/financial/wallet/topup', { cache: 'no-store' })
      if (r.ok) setWallet(await r.json())
      list.reload()
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

  const balance = wallet?.balance ?? 0
  const low = balance < (wallet?.minBalance ?? 0)

  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const cols: DataCol<LedgerEntry>[] = [
    { key: 'date', label: 'Date', sortParam: 'date', sortType: 'date', render: e => <span className="whitespace-nowrap text-foreground-secondary">{when(e.occurred_at)}</span> },
    { key: 'cat', label: 'Category', sortParam: 'cat', render: e => <span className={badgeCls('muted')}>{catLabel(catOf(e))}</span> },
    {
      key: 'ref',
      label: 'Reference',
      sortParam: 'ref',
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
      sortParam: 'amount',
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
        <Kpi label={filters ? 'Credits (filtered)' : 'Credits'} value={inr(totals.credit)} sub="recharges + credits" />
        <Kpi label={filters ? 'Debits (filtered)' : 'Debits'} value={inr(totals.debit)} sub="shipping + charges" />
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

      <Card title="Ledger" flush>
        <div className="px-5 pb-4">
          <ListFilters entity="wallet" fields={WALLET_FIELDS} search={WALLET_SEARCH} noun="Entries" exportable />
        </div>
        <DataTable<LedgerEntry> bare sortNs="ledger" rows={list.rows} infinite={list} cols={cols} rowKey={e => e.id} empty="No matching entries." />
      </Card>
    </PageBody>
  )
}

function AiSpendSection({ rows, days }: { rows: AiSpendRow[]; days: number }) {
  const total = rows.reduce((a, r) => a + r.spent, 0)
  const unpaid = rows.reduce((a, r) => a + r.unpaid, 0)
  const cols: DataCol<AiSpendRow>[] = [
    { key: 'feature', label: 'Feature', sort: r => aiFeatureLabel(r.feature).toLowerCase(), render: r => <span className="text-foreground">{aiFeatureLabel(r.feature)}</span> },
    { key: 'calls', label: 'Calls', num: true, sort: r => r.calls, render: r => <span className="text-foreground-secondary">{r.calls.toLocaleString('en-IN')}</span> },
    { key: 'spent', label: 'Spent', num: true, sort: r => r.spent, render: r => <span className="font-semibold text-foreground">{inr(r.spent)}</span> },
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
      <DataTable<AiSpendRow> bare sortNs="ai" rows={rows} cols={cols} rowKey={r => r.feature} />
    </Card>
  )
}
