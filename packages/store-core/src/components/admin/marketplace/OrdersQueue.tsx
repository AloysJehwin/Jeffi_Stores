'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ClipboardList, FileText, Package, Search, Tag, Truck, X } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import MobileCard from '@/components/admin/MobileCard'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import { Badge, api, btnGhost, btnPrimary, inputCls, money } from '@/components/admin/kit/core'
import { DataTable, type BulkAction, type DataCol } from '@/components/admin/kit/data-table'
import { Dialog } from '@/components/admin/kit/dialog'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { QueueBucket, QueueOrderRow } from '@/lib/marketplace/console'
import { CHANNEL_NAME, Countdown, StatusPill, useNow, type Channel } from './queue-shared'

// The marketplace orders queue: New (accept by) -> To pack -> Ready to dispatch -> Shipped, plus
// cancelled / returned. Actions go to the marketplace first; labels, invoices and manifests come
// from the marketplace (kept in the store's bucket after the first download).

const BUCKETS: { id: QueueBucket; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'to_pack', label: 'To pack' },
  { id: 'rtd', label: 'Ready to dispatch' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'closed', label: 'Cancelled / returned' },
]
const MANIFEST_MAX = 250
const REASONS = ['Out of stock', 'Price or listing error', 'Item damaged', 'Cannot dispatch in time', 'Other']

type Action = 'accept' | 'reject' | 'pack' | 'ready_to_dispatch'
type Doc = 'label' | 'invoice' | 'manifest'
const VERB: Record<Action, string> = { accept: 'Accepted', reject: 'Rejected', pack: 'Packed', ready_to_dispatch: 'Marked ready to dispatch' }

interface ActionResponse {
  ok: boolean
  done?: number
  results?: { id: string; ok: boolean; error?: string }[]
}

export default function OrdersQueue({ channel }: { channel: Channel }) {
  const name = CHANNEL_NAME[channel]
  const base = `/api/admin/${channel}`
  const scope = `${channel}_orders:write`
  const [bucket, setBucket] = useState<QueueBucket>('new')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<QueueOrderRow[]>([])
  const [counts, setCounts] = useState<Record<QueueBucket, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<QueueOrderRow[] | null>(null)
  const canWrite = useCanWrite(scope)
  const toast = useActionToast()
  const now = useNow()

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view: 'orders', bucket })
    if (search) params.set('q', search)
    const r = await api<{ orders: QueueOrderRow[]; counts: Record<QueueBucket, number> }>(`${base}/console?${params}`)
    setLoading(false)
    if (!r.ok) return setError(r.data.error || 'Could not load orders')
    setError(null)
    setRows(r.data.orders)
    setCounts(r.data.counts)
  }, [base, bucket, search])
  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function act(action: Action, list: QueueOrderRow[], reason?: string): Promise<boolean> {
    if (!list.length) return false
    setBusy(`${action}:${list.length === 1 ? list[0].id : 'bulk'}`)
    const r = await api<ActionResponse>(`${base}/orders/action`, { method: 'POST', json: { action, ids: list.map(o => o.id), reason } })
    setBusy(null)
    const failed = r.data.results?.filter(x => !x.ok) ?? []
    if (!r.ok) toast.error(r.data.error || 'Request failed')
    else if (failed.length) toast.warning(`${VERB[action]} ${r.data.done}; ${failed.length} failed: ${failed[0].error ?? 'unknown error'}`)
    else toast.success(`${VERB[action]} ${list.length === 1 ? `order ${list[0].external_order_id}` : `${r.data.done} orders`}.`)
    await load()
    return r.ok
  }

  async function manifest(list: QueueOrderRow[]) {
    if (list.length > MANIFEST_MAX) return toast.error(`A manifest takes at most ${MANIFEST_MAX} packets; ${list.length} are selected.`)
    setBusy('manifest')
    const r = await api<{ manifestId?: string; packets?: number }>(`${base}/manifest`, { method: 'POST', json: { ids: list.map(o => o.id) } })
    setBusy(null)
    if (r.ok) toast.success(`Manifest ${r.data.manifestId} created for ${r.data.packets} packet${r.data.packets === 1 ? '' : 's'}.`)
    else toast.error(r.data.error || 'Could not create the manifest')
    await load()
  }

  async function download(row: QueueOrderRow, kind: Doc) {
    setBusy(`${kind}:${row.id}`)
    try {
      const res = await fetch(`${base}/orders/${row.id}/document?kind=${kind}`, { credentials: 'include', headers: { 'x-requested-with': 'fetch' } })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return toast.error(data.error || `Could not get the ${kind}`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}-${kind}-${row.external_order_id}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } finally {
      setBusy(null)
    }
  }

  const rowActions = (r: QueueOrderRow): RowAction[] => {
    const docs = r.status !== 'created' && r.status !== 'rejected'
    return [
      { key: 'accept', label: 'Accept', icon: Check, variant: 'accent', scope, hidden: r.status !== 'created', busy: busy === `accept:${r.id}`, onSelect: () => void act('accept', [r]) },
      { key: 'pack', label: 'Mark packed', icon: Package, scope, hidden: channel !== 'ajio' || r.status !== 'accepted', busy: busy === `pack:${r.id}`, onSelect: () => void act('pack', [r]) },
      {
        key: 'rtd',
        label: 'Ready to dispatch',
        icon: Truck,
        variant: 'accent',
        scope,
        hidden: !(r.status === 'packed' || (r.status === 'accepted' && channel === 'myntra')),
        busy: busy === `ready_to_dispatch:${r.id}`,
        onSelect: () => void act('ready_to_dispatch', [r]),
      },
      { key: 'reject', label: 'Reject', icon: X, variant: 'danger', scope, hidden: r.status !== 'created' && r.status !== 'accepted', onSelect: () => setRejecting([r]) },
      { key: 'label', label: 'Download label', icon: Tag, hidden: !docs, busy: busy === `label:${r.id}`, onSelect: () => download(r, 'label') },
      { key: 'invoice', label: 'Download invoice', icon: FileText, hidden: !docs, busy: busy === `invoice:${r.id}`, onSelect: () => download(r, 'invoice') },
      { key: 'manifest', label: 'Download manifest', icon: ClipboardList, hidden: !r.manifest_id, busy: busy === `manifest:${r.id}`, onSelect: () => download(r, 'manifest') },
    ]
  }

  const orderCell = (r: QueueOrderRow) => (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{r.external_order_id}</p>
      {r.order_id && r.order_number && (
        <Link href={ap(`/admin/orders/${r.order_id}/view`)} className="text-xs text-accent-500 hover:underline">
          #{r.order_number}
        </Link>
      )}
    </div>
  )
  const itemsCell = (r: QueueOrderRow) => (
    <div className="min-w-0 max-w-[280px]">
      <p className="truncate text-foreground" title={r.items ?? ''}>
        {r.items || '-'}
      </p>
      <p className="flex flex-wrap items-center gap-1 text-xs text-foreground-muted">
        {r.units} unit{r.units === 1 ? '' : 's'}
        {(r.stock_state === 'short' || r.stock_state === 'unmatched' || r.unmatched) && (
          <span title={r.stock_note ?? ''}>
            <Badge tone="red">{r.stock_state === 'short' ? 'Short on stock' : 'SKU not matched'}</Badge>
          </span>
        )}
      </p>
    </div>
  )
  const packetCell = (r: QueueOrderRow) =>
    r.packet_id || r.tracking_number ? (
      <div className="text-xs">
        {r.packet_id && <p className="text-foreground">Packet {r.packet_id}</p>}
        {r.tracking_number && (
          <p className="text-foreground-muted">
            {r.courier ? `${r.courier} ` : ''}
            {r.tracking_url ? (
              <a href={r.tracking_url} target="_blank" rel="noopener noreferrer" className="text-accent-500 hover:underline">
                {r.tracking_number}
              </a>
            ) : (
              r.tracking_number
            )}
          </p>
        )}
        {r.manifest_id && <p className="text-foreground-muted">Manifest {r.manifest_id}</p>}
      </div>
    ) : (
      <span className="text-foreground-muted">-</span>
    )
  const deadline = bucket === 'new' ? { label: 'Accept by', at: (r: QueueOrderRow) => r.accept_by } : bucket === 'to_pack' ? { label: 'Dispatch by', at: (r: QueueOrderRow) => r.dispatch_by } : null

  const cols: DataCol<QueueOrderRow>[] = [
    { key: 'order', label: 'Order', render: orderCell, sort: r => r.external_order_id },
    { key: 'items', label: 'Items', render: itemsCell, className: 'whitespace-normal' },
    { key: 'total', label: 'Amount', num: true, render: r => money(r.order_total == null ? null : Number(r.order_total), 2), sort: r => Number(r.order_total ?? 0) },
    ...(deadline
      ? [{ key: 'deadline', label: deadline.label, render: (r: QueueOrderRow) => <Countdown at={deadline.at(r)} now={now} />, sort: (r: QueueOrderRow) => deadline.at(r) ?? '9999' }]
      : [{ key: 'packet', label: 'Packet / tracking', render: packetCell, hideBelow: 'lg' as const }]),
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  const bulk: BulkAction<QueueOrderRow>[] = []
  if (bucket === 'new') {
    bulk.push({ key: 'accept', label: 'Accept', icon: <Check className="h-3.5 w-3.5" />, scope, onRun: rows => void act('accept', rows) })
    bulk.push({ key: 'reject', label: 'Reject', icon: <X className="h-3.5 w-3.5" />, danger: true, scope, onRun: rows => setRejecting(rows) })
  } else if (bucket === 'to_pack') {
    if (channel === 'ajio') bulk.push({ key: 'pack', label: 'Mark packed', icon: <Package className="h-3.5 w-3.5" />, scope, onRun: rows => void act('pack', rows.filter(r => r.status === 'accepted')) })
    bulk.push({
      key: 'rtd',
      label: 'Ready to dispatch',
      icon: <Truck className="h-3.5 w-3.5" />,
      scope,
      onRun: rows => void act('ready_to_dispatch', channel === 'ajio' ? rows.filter(r => r.status === 'packed') : rows),
    })
  } else if (bucket === 'rtd' && channel === 'ajio') {
    bulk.push({ key: 'manifest', label: `Create manifest (max ${MANIFEST_MAX})`, icon: <ClipboardList className="h-3.5 w-3.5" />, scope, onRun: rows => manifest(rows.filter(r => !r.manifest_id)) })
  }

  const mobileCard = (r: QueueOrderRow) => (
    <MobileCard>
      <div className="flex items-start justify-between gap-2">
        {orderCell(r)}
        <StatusPill status={r.status} />
      </div>
      <div className="mt-2">{itemsCell(r)}</div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium tabular-nums text-foreground">{money(r.order_total == null ? null : Number(r.order_total), 2)}</span>
        {deadline ? <Countdown at={deadline.at(r)} now={now} /> : packetCell(r)}
      </div>
      <RowActions actions={rowActions(r)} size="sm" className="mt-3 flex-wrap" />
    </MobileCard>
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label={`${name} order stages`}>
        {BUCKETS.map(b => {
          const active = b.id === bucket
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setBucket(b.id)}
              className={`control-sm shrink-0 border ${active ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400' : 'border-border-default text-foreground-muted hover:text-foreground'}`}
            >
              {b.label}
              {counts && <span className="ml-1.5 tabular-nums text-xs opacity-80">{counts[b.id]}</span>}
            </button>
          )
        })}
      </div>

      {bucket === 'rtd' && channel === 'ajio' && (
        <p className="text-xs text-foreground-muted">Select up to {MANIFEST_MAX} packets and create a manifest, then hand the packets and the manifest to AJIO&apos;s courier.</p>
      )}
      {bucket === 'to_pack' && channel === 'ajio' && <p className="text-xs text-foreground-muted">Mark orders packed first: AJIO raises its purchase order then, and we invoice AJIO for it.</p>}

      <DataTable<QueueOrderRow>
        rows={rows}
        cols={cols}
        rowKey={r => r.id}
        loading={loading}
        error={error}
        selectable={canWrite && bulk.length > 0}
        bulkActions={bulk}
        rowActions={rowActions}
        mobileCard={mobileCard}
        noun="orders"
        toolbar={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Order, packet or tracking" aria-label="Search orders" className={`${inputCls} pl-9`} />
          </div>
        }
        empty={{ title: bucket === 'new' ? `No new ${name} orders` : 'Nothing here', body: bucket === 'new' ? `Orders ${name} pushes appear here to accept.` : undefined }}
      />

      <RejectDialog
        name={name}
        orders={rejecting}
        busy={busy?.startsWith('reject:') ?? false}
        onClose={() => setRejecting(null)}
        onReject={async reason => {
          const list = rejecting ?? []
          if (await act('reject', list, reason)) setRejecting(null)
        }}
      />
    </div>
  )
}

function RejectDialog({ name, orders, busy, onClose, onReject }: { name: string; orders: QueueOrderRow[] | null; busy: boolean; onClose: () => void; onReject: (reason: string) => void }) {
  const [preset, setPreset] = useState(REASONS[0])
  const [detail, setDetail] = useState('')
  useEffect(() => {
    if (orders) {
      setPreset(REASONS[0])
      setDetail('')
    }
  }, [orders])
  const reason = preset === 'Other' ? detail.trim() : detail.trim() ? `${preset}: ${detail.trim()}` : preset
  const n = orders?.length ?? 0
  return (
    <Dialog
      open={!!orders}
      onClose={onClose}
      title={n === 1 ? `Reject ${name} order ${orders![0].external_order_id}` : `Reject ${n} ${name} orders`}
      description={`${name} cancels the order${n === 1 ? '' : 's'} and stock held for ${n === 1 ? 'it' : 'them'} comes back.`}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`${btnPrimary} bg-red-600 hover:bg-red-700`} disabled={busy || reason.length < 3} onClick={() => onReject(reason)}>
            {busy ? 'Rejecting...' : 'Reject'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <AdminSelect label="Reason" value={preset} onChange={setPreset} options={REASONS.map(r => ({ value: r, label: r }))} />
        <div>
          <label htmlFor="mp-reject-detail" className="mb-1 block text-xs font-medium text-foreground-muted">
            {preset === 'Other' ? 'Reason (required)' : 'Details (optional)'}
          </label>
          <textarea id="mp-reject-detail" rows={3} maxLength={400} value={detail} onChange={e => setDetail(e.target.value)} className={inputCls} />
        </div>
      </div>
    </Dialog>
  )
}
