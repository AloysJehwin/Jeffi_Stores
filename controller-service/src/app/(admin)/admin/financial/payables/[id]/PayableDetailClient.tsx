'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { ap } from '@/lib/shared/admin-path'
import { formatINR as formatINRBase, formatDate } from '@/lib/shared/format'
import { Card, DataTable, DetailHeader, DetailSkeleton, EmptyState, EntityPage, Field, Fields, Kpi, KpiGrid, PageBody, StatusBadge, type DataCol } from '@/components/admin/kit'
import { SETTLEMENT_STATUS, payoutBadge } from '../../_components/shared'

const formatINR = (n: number) => formatINRBase(n, 0)

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
}

const PAYMENT_COLS: DataCol<any>[] = [
  { key: 'date', label: 'Date', sort: p => p.payment_date, render: p => <span className="whitespace-nowrap text-foreground-secondary">{formatDate(p.payment_date)}</span> },
  { key: 'method', label: 'Method', render: p => <span className="text-foreground-secondary">{METHOD_LABELS[p.payment_method] || p.payment_method}</span> },
  { key: 'amount', label: 'Amount', num: true, sort: p => parseFloat(p.amount), render: p => <span className="font-semibold text-foreground">{formatINR(parseFloat(p.amount))}</span> },
  { key: 'ref', label: 'Reference / UTR', render: p => <span className="font-mono text-xs text-foreground-secondary">{p.reference || '-'}</span> },
  { key: 'payout', label: 'Payout ID', render: p => <span className="font-mono text-xs text-foreground-secondary">{p.payout_id || '-'}</span> },
  { key: 'status', label: 'Status', render: p => payoutBadge(p.payout_status) },
]

function PaymentCard({ p }: { p: any }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-foreground-muted">{formatDate(p.payment_date)}</span>
        <span className="font-semibold text-foreground text-sm tabular-nums">{formatINR(parseFloat(p.amount))}</span>
      </div>
      <div className="text-xs text-foreground-secondary">{METHOD_LABELS[p.payment_method] || p.payment_method}</div>
      {(p.reference || p.payout_id) && <div className="text-xs text-foreground-secondary font-mono break-words">{p.payout_id || p.reference}</div>}
      {p.payout_status && payoutBadge(p.payout_status)}
    </div>
  )
}

export default function PayableDetailClient({ id }: { id: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/financial/payables/${id}`)
      .then(r => r.json())
      .then(j => {
        setData(j)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  if (!loading && !data?.expense) {
    return (
      <PageBody>
        <EmptyState title="Expense not found." action={{ label: 'Back to Payables', href: ap('/admin/financial?tab=payables') }} />
      </PageBody>
    )
  }

  if (loading || !data?.expense) {
    return (
      <PageBody>
        <DetailSkeleton />
      </PageBody>
    )
  }

  const e = data.expense
  const payments: any[] = data.payments || []
  const totalPaid = payments.reduce((s: number, p: any) => s + parseFloat(p.amount), 0)
  const remaining = parseFloat(e.total_amount) - totalPaid
  const overdue = e.due_date && new Date(e.due_date) < new Date() && e.status !== 'paid'

  return (
    <EntityPage
      header={
        <DetailHeader
          back={{ href: ap('/admin/financial'), label: 'Financial' }}
          title={<span className="font-mono">{e.expense_number}</span>}
          status={<StatusBadge status={e.status} map={SETTLEMENT_STATUS} />}
          subtitle={e.supplier_name}
        />
      }
      kpis={
        <KpiGrid>
          <Kpi label="Total" value={formatINR(parseFloat(e.total_amount))} highlight />
          <Kpi label="Paid" value={formatINR(totalPaid)} />
          <Kpi label="Remaining" value={remaining > 0 ? formatINR(remaining) : formatINR(0)} />
        </KpiGrid>
      }
      main={
        <Card title="Payment History" flush>
          {payments.length === 0 ? (
            <EmptyState bare title="No payments recorded yet" />
          ) : (
            <DataTable<any> bare rows={payments} cols={PAYMENT_COLS} rowKey={p => p.id} mobileCard={p => <PaymentCard p={p} />} />
          )}
        </Card>
      }
      aside={
        <>
          <Card title="Bill Details">
            <Fields cols={1}>
              <Field label="Supplier" value={e.supplier_name} />
              {e.supplier_gstin && <Field label="GSTIN" value={e.supplier_gstin} mono copy={e.supplier_gstin} />}
              {e.description && <Field label="Description" value={e.description} />}
              <Field label="Bill Date" value={formatDate(e.expense_date)} />
              {e.due_date && (
                <Field label="Due Date" value={<span className={overdue ? 'font-medium text-red-600 dark:text-red-400' : ''}>{formatDate(e.due_date)}</span>} />
              )}
              {e.notes && <Field label="Notes" value={e.notes} />}
            </Fields>
          </Card>

          <Card title="Amounts">
            <Fields cols={1}>
              <Field label="Base Amount" value={formatINR(parseFloat(e.amount))} />
              {parseFloat(e.tax_amount) > 0 && <Field label="Tax" value={formatINR(parseFloat(e.tax_amount))} />}
              <Field label="Total" value={<span className="font-bold">{formatINR(parseFloat(e.total_amount))}</span>} />
              <Field label="Paid" value={<span className="font-medium text-green-600 dark:text-green-400">{formatINR(totalPaid)}</span>} />
              {remaining > 0 && <Field label="Remaining" value={<span className="font-semibold text-red-600 dark:text-red-400">{formatINR(remaining)}</span>} />}
            </Fields>
          </Card>

          {e.po_number && (
            <Card
              title="Linked Purchase Order"
              action={
                <Link href={ap(`/admin/purchase-orders?tab=orders&po=${e.po_number}`)} className="text-xs text-accent-500 hover:underline">
                  View in Inventory
                </Link>
              }
            >
              <Fields cols={1}>
                <Field label="PO #" value={e.po_number} mono />
                {e.po_status && <Field label="PO Status" value={<span className="capitalize">{e.po_status}</span>} />}
                {e.po_order_date && <Field label="Order Date" value={formatDate(e.po_order_date)} />}
                {e.po_expected_date && <Field label="Expected" value={formatDate(e.po_expected_date)} />}
              </Fields>
            </Card>
          )}
        </>
      }
    />
  )
}
