'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PackageCheck, PackageX } from 'lucide-react'
import MobileCard from '@/components/admin/MobileCard'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import { Badge, api, money, when } from '@/components/admin/kit/core'
import { DataTable, type DataCol } from '@/components/admin/kit/data-table'
import { useActionToast } from '@/components/admin/kit/toast'
import { usePrompt } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { ReturnRow } from '@/lib/marketplace/console'
import { CHANNEL_NAME, RETURN_STATUS, StatusPill, type Channel } from './queue-shared'

// Marketplace returns and RTOs. "Received / QC ok" brings the stock back (once); "QC failed"
// records the return without restocking.

const OPEN = ['initiated', 'in_transit', 'received']

export default function MarketplaceReturns({ channel }: { channel: Channel }) {
  const name = CHANNEL_NAME[channel]
  const base = `/api/admin/${channel}`
  const scope = `${channel}_orders:write`
  const [scopeView, setScopeView] = useState<'open' | 'all'>('open')
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const prompt = usePrompt()
  const canWrite = useCanWrite(`${channel}_orders`)

  const load = useCallback(async () => {
    const r = await api<{ returns: ReturnRow[] }>(`${base}/console?view=returns&scope=${scopeView}`)
    setLoading(false)
    if (!r.ok) return setError(r.data.error || 'Could not load returns')
    setError(null)
    setRows(r.data.returns)
  }, [base, scopeView])
  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function act(row: ReturnRow, action: 'qc_pass' | 'qc_fail') {
    const note = await prompt({
      title: action === 'qc_pass' ? `Received and QC ok: ${row.external_return_id}` : `QC failed: ${row.external_return_id}`,
      message: action === 'qc_pass' ? 'The item is back and sellable; its stock is restored. Add a note (optional).' : 'Stock is not restored. Say what was wrong (optional).',
      placeholder: 'Note',
      confirmLabel: action === 'qc_pass' ? 'Mark QC ok' : 'Mark QC failed',
    })
    if (note === null) return
    setBusy(`${action}:${row.id}`)
    const r = await api<{ message?: string }>(`${base}/returns/action`, { method: 'POST', json: { id: row.id, action, note: note.trim() || undefined } })
    setBusy(null)
    toast.result({ ok: r.ok, text: r.ok ? r.data.message : r.data.error })
    load()
  }

  const rowActions = (r: ReturnRow): RowAction[] => [
    { key: 'pass', label: 'Received / QC ok', icon: PackageCheck, variant: 'accent', scope, hidden: !canWrite || !OPEN.includes(r.status), busy: busy === `qc_pass:${r.id}`, onSelect: () => act(r, 'qc_pass') },
    { key: 'fail', label: 'QC failed', icon: PackageX, variant: 'danger', scope, hidden: !canWrite || !OPEN.includes(r.status), busy: busy === `qc_fail:${r.id}`, onSelect: () => act(r, 'qc_fail') },
  ]

  const orderCell = (r: ReturnRow) => (
    <div className="min-w-0">
      <p className="text-foreground">{r.external_order_id ?? '-'}</p>
      {r.order_id && r.order_number && (
        <Link href={ap(`/admin/orders/${r.order_id}/view`)} className="text-xs text-accent-500 hover:underline">
          #{r.order_number}
        </Link>
      )}
    </div>
  )
  const stockCell = (r: ReturnRow) => (r.restocked ? <Badge tone="green">Restocked</Badge> : r.status === 'qc_failed' ? <Badge tone="muted">Not restocked</Badge> : <span className="text-foreground-muted">-</span>)

  const cols: DataCol<ReturnRow>[] = [
    { key: 'return', label: 'Return', render: r => <span className="font-medium text-foreground">{r.external_return_id}</span>, sort: r => r.external_return_id },
    { key: 'order', label: 'Order', render: orderCell },
    { key: 'type', label: 'Type', render: r => <Badge tone={r.return_type === 'rto' ? 'amber' : 'blue'}>{r.return_type === 'rto' ? 'RTO' : 'Customer'}</Badge> },
    { key: 'reason', label: 'Reason', hideBelow: 'lg', className: 'whitespace-normal', render: r => <span className="line-clamp-2 max-w-[240px] text-foreground-muted">{r.reason || '-'}</span> },
    { key: 'refund', label: 'Refund', num: true, hideBelow: 'xl', render: r => money(r.refund_amount == null ? null : Number(r.refund_amount), 2) },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} map={RETURN_STATUS} /> },
    { key: 'stock', label: 'Stock', render: stockCell },
    { key: 'updated', label: 'Updated', hideBelow: 'md', render: r => <span className="text-xs text-foreground-muted">{when(r.updated_at)}</span>, sort: r => r.updated_at },
  ]

  return (
    <DataTable<ReturnRow>
      rows={rows}
      cols={cols}
      rowKey={r => r.id}
      loading={loading}
      error={error}
      rowActions={rowActions}
      noun="returns"
      toolbar={
        <div className="flex h-control gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {(['open', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScopeView(s)}
              className={`flex items-center rounded-md px-3 text-xs font-medium ${scopeView === s ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
            >
              {s === 'open' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
      }
      mobileCard={r => (
        <MobileCard>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{r.external_return_id}</p>
              {orderCell(r)}
            </div>
            <StatusPill status={r.status} map={RETURN_STATUS} />
          </div>
          {r.reason && <p className="mt-2 text-xs text-foreground-muted">{r.reason}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={r.return_type === 'rto' ? 'amber' : 'blue'}>{r.return_type === 'rto' ? 'RTO' : 'Customer'}</Badge>
            {stockCell(r)}
          </div>
          <RowActions actions={rowActions(r)} size="sm" className="mt-3" />
        </MobileCard>
      )}
      empty={{ title: scopeView === 'open' ? 'No open returns' : 'No returns yet', body: `${name} returns and RTOs appear here when ${name} reports them.` }}
    />
  )
}
