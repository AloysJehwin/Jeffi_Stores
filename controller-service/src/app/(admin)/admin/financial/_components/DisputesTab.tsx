'use client'

import { useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col, type Tone } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { badgeCls, useActionToast } from '@/components/admin/kit'
import type { DisputeListRow, DisputesResponse } from '@/app/api/(admin)/admin/financial/disputes/route'

type Filter = 'open' | 'closed' | 'all'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

const STATUS: Record<DisputeListRow['status'], { label: string; tone: Tone }> = {
  open: { label: 'Needs response', tone: 'red' },
  under_review: { label: 'Under review', tone: 'amber' },
  won: { label: 'Won', tone: 'green' },
  lost: { label: 'Lost', tone: 'red' },
  closed: { label: 'Closed', tone: 'muted' },
}

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

function deadline(r: DisputeListRow) {
  if (!r.respond_by || r.status !== 'open') return fmtDate(r.respond_by)
  const days = Math.floor((new Date(r.respond_by).getTime() - Date.now()) / 86400000)
  const tone: Tone = days < 0 ? 'red' : days < 3 ? 'red' : days < 7 ? 'amber' : 'muted'
  return (
    <span className="inline-flex items-center gap-1.5">
      {fmtDate(r.respond_by)}
      <span className={badgeCls(tone)}>{days < 0 ? 'overdue' : days === 0 ? 'today' : `${days}d left`}</span>
    </span>
  )
}

export function DisputesTab() {
  const [filter, setFilter] = useState<Filter>('open')
  const [syncing, setSyncing] = useState(false)
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const { data, error, loading, reload } = useOverviewData<DisputesResponse>(`/api/admin/financial/disputes?status=${filter}`)

  async function sync() {
    setSyncing(true)
    const res = await fetch('/api/admin/financial/disputes/sync', { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    setSyncing(false)
    if (!res.ok) return toast.error(j.error || 'Could not sync disputes.')
    toast.success(j.saved ? `Synced ${j.saved} dispute(s).` : 'No disputes on this account.')
    reload()
  }

  const cols: Col<DisputeListRow>[] = [
    {
      key: 'order',
      label: 'Order',
      render: r =>
        r.order_id ? (
          <Link href={`/admin/orders/${r.order_id}/view`} className="text-accent-500 hover:underline font-mono text-xs">
            #{r.order_number}
          </Link>
        ) : (
          <span className="font-mono text-xs">{r.razorpay_payment_id}</span>
        ),
    },
    { key: 'amount', label: 'Amount', num: true, sort: r => r.amount, render: r => money(r.amount) },
    { key: 'reason', label: 'Reason', render: r => r.reason_description || r.reason_code || '-' },
    { key: 'status', label: 'Status', render: r => <span className={badgeCls(STATUS[r.status]?.tone ?? 'muted')}>{STATUS[r.status]?.label ?? r.status}</span> },
    { key: 'respond', label: 'Respond by', sort: r => r.respond_by ?? '', render: deadline },
    { key: 'opened', label: 'Opened', sort: r => r.created_at, render: r => fmtDate(r.created_at) },
    {
      key: 'link',
      label: '',
      render: r => (
        <a
          href={`https://dashboard.razorpay.com/app/disputes/${r.razorpay_dispute_id}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent-500 hover:underline whitespace-nowrap"
        >
          {r.status === 'open' ? 'Respond on Razorpay' : 'View on Razorpay'}
        </a>
      ),
    },
  ]

  const t = data?.totals
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-control rounded-lg border border-border-default text-sm overflow-hidden">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`h-full px-4 font-medium transition-colors ${filter === f.value ? 'bg-accent-500 text-white' : 'bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="control-md border border-border-default bg-surface-elevated text-foreground font-medium hover:bg-surface-secondary disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Razorpay'}
          </button>
        )}
      </div>
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? (
        <OverviewSkeleton />
      ) : (
        data &&
        t && (
          <>
            <KpiGrid>
              <Kpi label="Open" value={money(t.open_amount)} sub={`${count(t.open_count)} disputes`} highlight={t.open_count > 0} />
              <Kpi label="Due in 3 days" value={count(t.due_soon)} sub="respond on Razorpay" />
              <Kpi label="Lost" value={money(t.lost_amount)} sub="taken back by banks" />
              <Kpi label="Won" value={count(t.won_count)} sub="disputes" />
            </KpiGrid>
            <Section title="Chargebacks">
              <Table rows={data.rows} cols={cols} rowKey={r => r.id} empty="No disputes. A customer's bank raising a chargeback shows up here." />
            </Section>
          </>
        )
      )}
    </div>
  )
}
