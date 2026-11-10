'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { ActionButton, CopyValue, DataTable, Section, StatusBadge, fetchJson, useActionToast, usePagedList, type DataCol, type StatusMap } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'

// Manual-UPI intents (GET /api/admin/payments/upi). Field names are read loosely: the list may carry
// the raw intent (refs / result) or already-joined order and customer columns.
interface Row {
  id: string
  status: string
  purpose?: string
  amount_paise?: number | string
  amountPaise?: number
  utr?: string | null
  payer_vpa?: string | null
  created_at?: string
  confirmed_at?: string | null
  order_id?: string | null
  order_number?: string | null
  orderId?: string | null
  orderNumber?: string | null
  customer_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  customerName?: string | null
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null
  refs?: { orderId?: string | null } | null
  result?: { orderId?: string | null; orderNumber?: string | null } | null
  /** Bank emails that match this payment but could not be verified as coming from a bank (never auto-confirm). */
  suggestions?: Suggestion[] | null
  suggestion?: Suggestion | null
}

interface Suggestion {
  id?: string
  utr?: string | null
  amount_paise?: number | string | null
  amountPaise?: number | null
  sender_vpa?: string | null
  senderVpa?: string | null
  bank_domain?: string | null
  bankDomain?: string | null
  observed_at?: string | null
  observedAt?: string | null
}

const STATUS: StatusMap = {
  awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'amber' },
  completed: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  pending: { label: 'Pending', tone: 'muted' },
  failed: { label: 'Failed', tone: 'red' },
  expired: { label: 'Expired', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}
const FILTERS = [
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'completed', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]
const PAGE_SIZE = 10

const inr = (r: Row) => `₹${((Number(r.amount_paise ?? r.amountPaise) || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const orderId = (r: Row) => r.order_id ?? r.orderId ?? r.result?.orderId ?? r.refs?.orderId ?? null
const orderNo = (r: Row) => r.order_number ?? r.orderNumber ?? r.result?.orderNumber ?? null
const customer = (r: Row) => r.customer_name ?? r.customerName ?? r.customer?.name ?? null
const contact = (r: Row) => r.customer_email ?? r.customer?.email ?? r.customer_phone ?? r.customer?.phone ?? r.payer_vpa ?? null
const suggestionsOf = (r: Row): Suggestion[] => (r.suggestions?.length ? r.suggestions : r.suggestion ? [r.suggestion] : [])
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-'

export default function UpiConfirmationsClient() {
  const [status, setStatus] = useState('awaiting_confirmation')
  const toast = useActionToast()
  const list = usePagedList<Row>({
    key: status,
    pageSize: PAGE_SIZE,
    fetchPage: async (page, signal) => {
      const q = new URLSearchParams({ status, page: String(page), limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })
      const data = await fetchJson(`/api/admin/payments/upi?${q}`, signal)
      const all: Row[] = data.items ?? data.intents ?? data.rows ?? []
      // An API that ignores paging returns everything; slice so the Pager still works.
      const rows = all.length > PAGE_SIZE ? all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : all
      return { rows, total: data.total ?? (all.length > PAGE_SIZE ? all.length : null) }
    },
  })

  async function decide(r: Row, action: 'approve' | 'reject') {
    try {
      await fetchJson(`/api/admin/payments/upi/${encodeURIComponent(r.id)}/decide`, undefined, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      toast.success(action === 'approve' ? `Payment of ${inr(r)} approved.` : `Payment of ${inr(r)} rejected.`)
      list.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the payment')
    }
  }

  const cols: DataCol<Row>[] = [
    {
      key: 'order',
      label: 'Order',
      render: r => {
        const id = orderId(r)
        const label = orderNo(r) ? `#${orderNo(r)}` : (r.purpose ?? 'payment').replace(/_/g, ' ')
        return id ? (
          <Link href={ap(`/admin/orders/${id}`)} className="font-medium text-accent-500 hover:underline">
            {label}
          </Link>
        ) : (
          <span className="text-foreground-secondary">{label}</span>
        )
      },
    },
    {
      key: 'customer',
      label: 'Customer',
      render: r => (
        <span className="text-foreground">
          {customer(r) ?? '-'}
          {contact(r) && <span className="block text-xs text-foreground-muted">{contact(r)}</span>}
        </span>
      ),
    },
    { key: 'amount', label: 'Amount', num: true, render: r => <span className="font-semibold tabular-nums text-foreground">{inr(r)}</span> },
    {
      key: 'utr',
      label: 'UTR',
      render: r =>
        r.utr ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground">
            {r.utr}
            <CopyValue value={r.utr} label="Copy UTR" />
          </span>
        ) : (
          <span className="text-foreground-muted">-</span>
        ),
    },
    {
      key: 'suggestion',
      label: 'Unverified bank email',
      hideBelow: 'lg',
      render: r => {
        const list = suggestionsOf(r)
        if (!list.length) return <span className="text-foreground-muted">-</span>
        return (
          <span className="block space-y-1 text-xs text-foreground-secondary">
            {list.slice(0, 3).map((s, i) => {
              const paise = Number(s.amount_paise ?? s.amountPaise)
              const utr = s.utr ?? null
              return (
                <span key={s.id ?? i} className="block">
                  {Number.isFinite(paise) && paise > 0 ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Credit'}
                  {utr ? (
                    <>
                      {' · UTR '}
                      <span className={`font-mono ${r.utr && utr === r.utr ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>{utr}</span>
                    </>
                  ) : null}
                  <span className="block text-foreground-muted">
                    {[s.sender_vpa ?? s.senderVpa, s.bank_domain ?? s.bankDomain, when(s.observed_at ?? s.observedAt)].filter(v => v && v !== '-').join(' · ')}
                  </span>
                </span>
              )
            })}
            <span className="block text-[11px] text-foreground-muted">Sender not verified — check your bank before approving.</span>
          </span>
        )
      },
    },
    { key: 'when', label: 'When', hideBelow: 'md', render: r => <span className="whitespace-nowrap text-foreground-secondary">{when(r.confirmed_at ?? r.created_at)}</span> },
    { key: 'status', label: 'Status', hideBelow: 'lg', render: r => <StatusBadge status={r.status} map={STATUS} /> },
    {
      key: 'actions',
      label: '',
      render: r =>
        r.status === 'awaiting_confirmation' ? (
          <span className="flex flex-wrap justify-end gap-2">
            <ActionButton
              variant="primary"
              action={{
                label: 'Approve',
                icon: Check,
                scope: 'orders:write',
                confirm: { title: 'Approve this payment?', message: `Confirm that ${inr(r)} with UTR ${r.utr ?? '-'} reached your account. The order is marked paid.`, confirmLabel: 'Approve' },
                onClick: () => decide(r, 'approve'),
              }}
            />
            <ActionButton
              action={{
                label: 'Reject',
                icon: X,
                danger: true,
                scope: 'orders:write',
                confirm: { title: 'Reject this payment?', message: `Reject the UTR ${r.utr ?? '-'} for ${inr(r)}. The order stays unpaid and the customer can pay again.`, confirmLabel: 'Reject', variant: 'danger' },
                onClick: () => decide(r, 'reject'),
              }}
            />
          </span>
        ) : null,
    },
  ]

  return (
    <Section title="Payments">
      <div className="mb-4 w-full max-w-[14rem]">
        <AdminSelect sm value={status} onChange={setStatus} options={FILTERS} />
      </div>
      <DataTable<Row>
        bare
        rows={list.rows}
        cols={list.rows.some(r => suggestionsOf(r).length) ? cols : cols.filter(c => c.key !== 'suggestion')}
        rowKey={r => r.id}
        pager={list.pager}
        loading={list.loading}
        error={list.error}
        noun="payments"
        empty={status === 'awaiting_confirmation' ? 'No payments are waiting for confirmation.' : 'No matching payments.'}
      />
    </Section>
  )
}
