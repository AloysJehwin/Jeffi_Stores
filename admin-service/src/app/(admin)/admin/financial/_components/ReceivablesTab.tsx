'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useActionToast } from '@/components/admin/kit'
import {
  Banner,
  Kpi,
  KpiGrid,
  Section,
  Table,
  btnGhost,
  btnPrimary,
  count,
  money,
  type Col,
} from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { KeyedTrendCard } from '@/components/admin/kit/charts'
import { delta } from '@/lib/overview/period'
import {
  AGING_COLORS,
  AgingDonutCard,
  FinancePeriodBar,
  useFinancePeriod,
  type FinanceOverviewContract,
} from './finance'

// Finance → Receivables, cloned from the AiCosts tab shape. Range comes from the shared ?from&to;
// each row deep-links into orders/customers and the mark-paid button hits the existing write route.

type Totals = { outstanding: number; invoice_count: number; overdue: number; avg_days: number }
type AgingKey = 'd0_30' | 'd31_60' | 'd60_plus'
type AgingRow = { key: AgingKey; amount: number; count: number }
type DebtorRow = {
  user_id: string | null
  order_id: string
  customer_name: string
  customer_phone: string | null
  outstanding: number
  invoice_count: number
  oldest_days: number
}
type OverdueRow = {
  order_id: string
  order_number: string
  invoice_number: string | null
  customer_name: string
  user_id: string | null
  total_amount: number
  invoice_date: string
  days_outstanding: number
  aging_bucket: AgingKey
  payment_status: string
}
type Receivables = FinanceOverviewContract<Totals> & {
  by_aging: AgingRow[]
  top_debtors: DebtorRow[]
  overdue: OverdueRow[]
}

const AGING_LABEL: Record<AgingKey, string> = {
  d0_30: '0-30 days',
  d31_60: '31-60 days',
  d60_plus: '60+ days',
}
const AGING_COLOR: Record<AgingKey, string> = {
  d0_30: AGING_COLORS.current,
  d31_60: AGING_COLORS.d31_60,
  d60_plus: AGING_COLORS.d90_plus,
}
const AGING_SERIES_KEYS: AgingKey[] = ['d0_30', 'd31_60', 'd60_plus']

export function ReceivablesTab() {
  const { from, to } = useFinancePeriod('30d')
  const { data, error, loading, reload } = useOverviewData<Receivables>(
    `/api/admin/financial/receivables?from=${from}&to=${to}`
  )

  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} onChanged={reload} />}
    </div>
  )
}

function Body({ d, onChanged }: { d: Receivables; onChanged: () => void }) {
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const [paying, setPaying] = useState<string | null>(null)
  const c = d.current
  const p = d.previous
  const agingTotal = d.by_aging.reduce((s, r) => s + r.amount, 0)

  const markPaid = async (orderId: string) => {
    setPaying(orderId)
    try {
      const r = await fetch(`/api/admin/orders/${orderId}/payment-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'paid' }),
      })
      toast.result({ ok: r.ok }, { success: 'Marked as paid.', error: 'Could not mark as paid.' })
      if (r.ok) onChanged()
    } finally {
      setPaying(null)
    }
  }

  const exportCSV = () => {
    const rows = d.overdue
    if (!rows.length) return
    const header = ['Invoice', 'Order', 'Customer', 'Date', 'Days', 'Amount', 'Status']
    const body = rows.map(r => [
      r.invoice_number ?? '',
      r.order_number,
      r.customer_name,
      r.invoice_date,
      r.days_outstanding,
      r.total_amount,
      r.payment_status,
    ])
    const csv = [header, ...body]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `receivables-${d.range.from}-to-${d.range.to}.csv`
    a.click()
  }

  const customerHref = (r: { user_id: string | null; order_id: string }) =>
    r.user_id ? ap(`/admin/customers/${r.user_id}/view`) : ap(`/admin/orders/${r.order_id}/view`)

  const debtorCols: Col<DebtorRow>[] = [
    {
      key: 'customer',
      label: 'Customer',
      render: r => (
        <Link href={customerHref(r)} className="font-medium text-foreground hover:text-accent-500 hover:underline">
          {r.customer_name || 'Guest'}
          {r.customer_phone && <span className="ml-2 text-xs text-foreground-muted">+91 {r.customer_phone}</span>}
        </Link>
      ),
    },
    { key: 'invoices', label: 'Invoices', num: true, render: r => count(r.invoice_count) },
    { key: 'oldest', label: 'Oldest', num: true, render: r => `${r.oldest_days}d` },
    { key: 'outstanding', label: 'Outstanding', num: true, render: r => money(r.outstanding, 2) },
  ]

  const overdueCols: Col<OverdueRow>[] = [
    {
      key: 'invoice',
      label: 'Invoice',
      render: r => (
        <Link href={ap(`/admin/orders/${r.order_id}/view`)} className="font-mono text-xs text-foreground hover:text-accent-500 hover:underline">
          {r.invoice_number || r.order_number}
        </Link>
      ),
    },
    {
      key: 'customer',
      label: 'Customer',
      render: r =>
        r.user_id ? (
          <Link href={ap(`/admin/customers/${r.user_id}/view`)} className="text-foreground hover:text-accent-500 hover:underline">
            {r.customer_name}
          </Link>
        ) : (
          <span className="text-foreground">{r.customer_name}</span>
        ),
    },
    { key: 'date', label: 'Date', render: r => r.invoice_date },
    { key: 'days', label: 'Days', num: true, render: r => `${r.days_outstanding}d` },
    { key: 'amount', label: 'Amount', num: true, render: r => money(r.total_amount, 2) },
    {
      key: 'action',
      label: '',
      render: r =>
        canWrite ? (
          <button
            type="button"
            className={btnGhost}
            disabled={paying === r.order_id}
            onClick={() => markPaid(r.order_id)}
          >
            {paying === r.order_id ? '…' : 'Mark paid'}
          </button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi
          label="Outstanding"
          value={money(c.outstanding, 2)}
          delta={delta(c.outstanding, p.outstanding)}
          invert
          highlight
          sub={`${count(c.invoice_count)} unpaid`}
        />
        <Kpi label="Overdue (60+ days)" value={money(c.overdue, 2)} delta={delta(c.overdue, p.overdue)} invert />
        <Kpi
          label="Avg days outstanding"
          value={`${c.avg_days}d`}
          delta={delta(c.avg_days, p.avg_days)}
          invert
        />
        <Kpi
          label="Invoices"
          value={count(c.invoice_count)}
          delta={delta(c.invoice_count, p.invoice_count)}
          invert
        />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Outstanding by aging"
            data={d.series ?? []}
            keys={AGING_SERIES_KEYS}
            labels={AGING_LABEL}
            granularity={d.bucket}
          />
        </div>
        <AgingDonutCard
          rows={d.by_aging.map(a => ({ label: AGING_LABEL[a.key], value: a.amount, color: AGING_COLOR[a.key] }))}
          total={money(agingTotal)}
          centerLabel="Outstanding"
        />
      </div>

      <Section title="Top debtors">
        <Table
          rows={d.top_debtors}
          cols={debtorCols}
          rowKey={r => `${r.user_id ?? 'guest'}-${r.order_id}`}
          empty="No unpaid customers in this period."
        />
      </Section>

      <Section
        title="Overdue invoices"
        action={
          d.overdue.length > 0 ? (
            <button type="button" className={btnPrimary} onClick={exportCSV}>
              Export CSV
            </button>
          ) : undefined
        }
      >
        <Table rows={d.overdue} cols={overdueCols} rowKey={r => r.order_id} empty="Nothing overdue in this period." />
      </Section>
    </div>
  )
}
