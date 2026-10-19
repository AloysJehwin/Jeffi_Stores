'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import {
  Banner,
  Dialog,
  FormField,
  Kpi,
  KpiGrid,
  NumberInput,
  Section,
  Table,
  TextInput,
  useActionToast,
  type Col,
} from '@/components/admin/kit'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/kit/period'
import { KeyedTrendCard, type TrendPoint } from '@/components/admin/kit/charts'
import { delta } from '@/lib/overview/period'
import {
  AGING_COLORS,
  AgingDonutCard,
  FinancePeriodBar,
  useFinancePeriod,
  type AgingDonutRow,
} from './finance'
import { PayablesPayModal } from './PayablesPayModal'
import { StatusBadge, formatINR } from './shared'

// Client-side mirror of the server contract (see api/.../payables/summary.ts). Narrowed once here.

type Totals = {
  outstanding: number
  due_this_week: number
  overdue: number
  paid: number
  bills_open: number
}

type Bill = {
  id: string
  expense_number: string
  supplier_id: string | null
  supplier_name: string
  total_amount: number
  paid_amount: number
  due_date: string | null
  days_overdue: number | null
  status: string
  supplier_bank_name: string | null
  supplier_account_number: string | null
  supplier_ifsc: string | null
  supplier_upi_id: string | null
}

type SupplierRow = {
  supplier_id: string | null
  supplier_name: string
  bills_open: number
  outstanding: number
  overdue: number
}

type AgingKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
type Aging = { key: AgingKey; label: string; value: number }

type Overview = {
  range: { from: string; to: string }
  previous_range: { from: string; to: string }
  bucket: 'day' | 'week' | 'month'
  current: Totals
  previous: Totals
  series: TrendPoint[]
  pay_methods: string[]
  by_dim: Aging[]
  by_dim2: SupplierRow[]
  top: Bill[]
}

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
}

const AGING_COLOR: Record<AgingKey, string> = {
  current: AGING_COLORS.current,
  d1_30: 'rgb(132 204 22)',
  d31_60: AGING_COLORS.d31_60,
  d61_90: AGING_COLORS.d61_90,
  d90_plus: AGING_COLORS.d90_plus,
}

const remaining = (b: Bill) => Math.max(b.total_amount - b.paid_amount, 0)

export function PayablesTab({ initialData: _initialData }: { initialData?: unknown } = {}) {
  const { from, to } = useFinancePeriod()
  const { data, error, loading, reload } = useOverviewData<Overview>(
    `/api/admin/financial/payables?from=${from}&to=${to}`
  )
  const [showAdd, setShowAdd] = useState(false)
  const [payBill, setPayBill] = useState<Bill | null>(null)
  const canWrite = useCanWrite('financial:write')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FinancePeriodBar onRefresh={reload} busy={loading} />
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="control-md inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 text-sm font-medium text-white hover:bg-accent-600"
          >
            <Plus className="h-4 w-4" /> Add bill
          </button>
        )}
      </div>

      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} canWrite={canWrite} onPay={setPayBill} />}

      {showAdd && (
        <AddBillDialog
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            reload()
          }}
        />
      )}

      {payBill && (
        <PayModalHost
          bill={payBill}
          onClose={() => {
            setPayBill(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function Body({ d, canWrite, onPay }: { d: Overview; canWrite: boolean; onPay: (b: Bill) => void }) {
  const c = d.current
  const p = d.previous

  const agingRows: AgingDonutRow[] = d.by_dim.map(r => ({
    label: r.label,
    value: r.value,
    color: AGING_COLOR[r.key],
  }))

  const billCols: Col<Bill>[] = [
    {
      key: 'bill',
      label: 'Bill',
      render: r => (
        <div className="min-w-0">
          <Link
            href={ap(`/admin/financial/payables/${r.id}/view`)}
            className="font-mono text-xs text-foreground hover:text-accent-500 hover:underline"
          >
            {r.expense_number}
          </Link>
          <div className="text-xs text-foreground-muted">
            {r.supplier_id ? (
              <Link
                href={ap(`/admin/suppliers/${r.supplier_id}/view`)}
                className="hover:text-accent-500 hover:underline"
              >
                {r.supplier_name}
              </Link>
            ) : (
              r.supplier_name
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'due',
      label: 'Due',
      render: r =>
        r.due_date ? (
          <span className={r.days_overdue ? 'text-red-500 dark:text-red-400' : 'text-foreground-muted'}>
            {r.due_date}
            {r.days_overdue ? ` · ${r.days_overdue}d late` : ''}
          </span>
        ) : (
          <span className="text-foreground-muted">—</span>
        ),
    },
    { key: 'total', label: 'Amount', num: true, render: r => formatINR(r.total_amount) },
    { key: 'paid', label: 'Paid', num: true, render: r => formatINR(r.paid_amount) },
    {
      key: 'due_now',
      label: 'Due now',
      num: true,
      render: r => <span className="font-medium">{formatINR(remaining(r))}</span>,
    },
    { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
    {
      key: 'action',
      label: '',
      render: r =>
        canWrite ? (
          <button
            type="button"
            onClick={() => onPay(r)}
            className="control-sm rounded-md bg-accent-500 px-2 text-xs font-medium text-white hover:bg-accent-600"
          >
            Pay
          </button>
        ) : null,
    },
  ]

  const supplierCols: Col<SupplierRow>[] = [
    {
      key: 'name',
      label: 'Supplier',
      render: r =>
        r.supplier_id ? (
          <Link
            href={ap(`/admin/suppliers/${r.supplier_id}/view`)}
            className="font-medium text-foreground hover:text-accent-500 hover:underline"
          >
            {r.supplier_name}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{r.supplier_name}</span>
        ),
    },
    { key: 'bills_open', label: 'Open bills', num: true, render: r => r.bills_open.toLocaleString('en-IN') },
    { key: 'overdue', label: 'Overdue', num: true, render: r => formatINR(r.overdue) },
    { key: 'outstanding', label: 'Outstanding', num: true, render: r => formatINR(r.outstanding) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi
          label="Outstanding"
          value={formatINR(c.outstanding)}
          delta={delta(c.outstanding, p.outstanding)}
          invert
          highlight
        />
        <Kpi label="Overdue" value={formatINR(c.overdue)} delta={delta(c.overdue, p.overdue)} invert />
        <Kpi label="Due this week" value={formatINR(c.due_this_week)} sub="Next 7 days" />
        <Kpi label="Paid in period" value={formatINR(c.paid)} delta={delta(c.paid, p.paid)} />
        <Kpi
          label="Open bills"
          value={c.bills_open.toLocaleString('en-IN')}
          delta={delta(c.bills_open, p.bills_open)}
          invert
        />
      </KpiGrid>

      {c.overdue > 0 && (
        <Banner ok={false}>
          {formatINR(c.overdue)} is past due. Review the open bills table and remit the overdue ones first.
        </Banner>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Outflow by method"
            data={d.series}
            keys={d.pay_methods}
            labels={METHOD_LABEL}
            granularity={d.bucket}
          />
        </div>
        <AgingDonutCard
          title="Aging"
          rows={agingRows}
          total={formatINR(c.outstanding)}
          centerLabel="Outstanding"
        />
      </div>

      <Section title="Open bills">
        <Table rows={d.top} cols={billCols} rowKey={r => r.id} empty="No open bills right now." />
      </Section>

      <Section title="Top suppliers by outstanding">
        <Table
          rows={d.by_dim2}
          cols={supplierCols}
          rowKey={r => r.supplier_id ?? r.supplier_name}
          empty="No supplier balances in this period."
        />
      </Section>
    </div>
  )
}

// Add-bill dialog; posts to the untouched POST /api/admin/financial/payables route.
function AddBillDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useActionToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    supplier_name: '',
    amount: '',
    tax_amount: '',
    expense_date: '',
    due_date: '',
    description: '',
    supplier_gstin: '',
    notes: '',
  })
  const canSubmit = !!(form.supplier_name && form.amount && form.expense_date) && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    const res = await fetch('/api/admin/financial/payables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    toast.result({ ok: res.ok }, { success: 'Bill saved.', error: 'Could not save the bill.' })
    setSaving(false)
    if (res.ok) onSaved()
  }

  const upd = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Dialog
      open
      size="lg"
      title="New supplier bill"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="control-md border border-border-default px-3 text-sm text-foreground hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="control-md bg-accent-500 px-3 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save bill'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Supplier" required>
          <TextInput value={form.supplier_name} onChange={e => upd('supplier_name')(e.target.value)} />
        </FormField>
        <FormField label="GSTIN">
          <TextInput
            className="font-mono"
            maxLength={15}
            placeholder="00XXXXX0000X0Z0"
            value={form.supplier_gstin}
            onChange={e => upd('supplier_gstin')(e.target.value.toUpperCase())}
          />
        </FormField>
        <FormField label="Description" span={2}>
          <TextInput value={form.description} onChange={e => upd('description')(e.target.value)} />
        </FormField>
        <FormField label="Amount (excl. tax)" required>
          <NumberInput step="0.01" value={form.amount} onChange={e => upd('amount')(e.target.value)} />
        </FormField>
        <FormField label="Tax amount">
          <NumberInput step="0.01" value={form.tax_amount} onChange={e => upd('tax_amount')(e.target.value)} />
        </FormField>
        <FormField label="Bill date" required>
          <DatePicker className="w-full" value={form.expense_date} onChange={v => upd('expense_date')(v)} />
        </FormField>
        <FormField label="Due date">
          <DatePicker className="w-full" value={form.due_date} onChange={v => upd('due_date')(v)} />
        </FormField>
        <FormField label="Notes" span={2}>
          <TextInput value={form.notes} onChange={e => upd('notes')(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  )
}

// Preserves PayablesPayModal exactly (manual record + RazorpayX payout); only the open/close
// plumbing changes.
function PayModalHost({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const toast = useActionToast()
  const remainingStr = remaining(bill).toFixed(2)
  const [payTab, setPayTab] = useState<'manual' | 'razorpayx'>('manual')
  const [payForm, setPayForm] = useState({
    amount: remainingStr,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'bank_transfer',
    reference: '',
  })
  const [rzpForm, setRzpForm] = useState({ mode: 'IMPS', amount: remainingStr, notes: '' })
  const [paying, setPaying] = useState(false)
  const [payoutResult, setPayoutResult] = useState<{ ok: boolean; payout_id?: string; status?: string; error?: string } | null>(null)
  const hasBank = !!(bill.supplier_account_number && bill.supplier_ifsc)
  const hasUpi = !!bill.supplier_upi_id

  const submitPayment = async () => {
    if (!payForm.amount) return
    setPaying(true)
    const res = await fetch(`/api/admin/financial/payables/${bill.id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payForm),
    })
    toast.result({ ok: res.ok }, { success: 'Payment recorded.', error: 'Could not record the payment.' })
    setPaying(false)
    if (res.ok) onClose()
  }

  const submitPayout = async () => {
    if (!rzpForm.amount) return
    setPaying(true)
    setPayoutResult(null)
    const res = await fetch(`/api/admin/financial/payables/${bill.id}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rzpForm),
    })
    const json = await res.json()
    setPaying(false)
    if (json.success) {
      setPayoutResult({ ok: true, payout_id: json.payout_id, status: json.payout_status })
      toast.success(`Payout queued. ID ${json.payout_id}, status ${json.payout_status}.`)
      fetch('/api/admin/financial/payables/sync-payouts', { method: 'POST' }).catch(() => {})
      onClose()
    } else {
      setPayoutResult({ ok: false, error: json.error })
      toast.error(json.error || 'Payout failed.')
    }
  }

  return (
    <PayablesPayModal
      payModal={{
        ...bill,
        total_amount: String(bill.total_amount),
        paid_amount: String(bill.paid_amount),
      }}
      payTab={payTab}
      setPayTab={setPayTab as Dispatch<SetStateAction<'manual' | 'razorpayx'>>}
      payForm={payForm}
      setPayForm={setPayForm}
      rzpForm={rzpForm}
      setRzpForm={setRzpForm}
      paying={paying}
      payoutResult={payoutResult}
      setPayoutResult={setPayoutResult as Dispatch<SetStateAction<unknown>>}
      hasBank={hasBank}
      hasUpi={hasUpi}
      submitPayment={submitPayment}
      submitPayout={submitPayout}
      closePayModal={onClose}
    />
  )
}
