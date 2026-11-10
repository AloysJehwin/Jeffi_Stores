'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Upload } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { Badge, Banner, Kpi, KpiGrid, Section, Table, api, btnGhost, count, inputCls, money, when, type Col } from '@/components/admin/channels/ui'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { InventoryRow, InventoryView } from '@/lib/marketplace/stock'
import { InventoryLoading } from './skeletons'

type Channel = 'myntra' | 'ajio'
const LABEL: Record<Channel, string> = { myntra: 'Myntra', ajio: 'AJIO' }

const drifted = (r: InventoryRow) => r.ourPrice != null && r.listedPrice != null && Math.abs(r.ourPrice - r.listedPrice) >= 0.01

const COLS: Col<InventoryRow>[] = [
  {
    key: 'sku',
    label: 'Listing',
    render: r => (
      <div className="min-w-0 max-w-[18rem]">
        <p className="truncate text-sm text-foreground">{r.title}</p>
        <p className="truncate font-mono text-xs text-foreground-muted">{r.sku}</p>
      </div>
    ),
    sort: r => r.title,
  },
  { key: 'stock', label: 'Our stock', num: true, render: r => (r.available == null ? '-' : count(r.available)), sort: r => r.available ?? -1 },
  { key: 'reserved', label: 'Reserved', num: true, render: r => (r.reserved ? count(r.reserved) : '-'), sort: r => r.reserved },
  {
    key: 'push',
    label: 'Pushed / to push',
    num: true,
    render: r =>
      r.pushedQty === r.desired ? (
        count(r.desired)
      ) : (
        <span>
          {r.pushedQty == null ? '-' : count(r.pushedQty)} → <span className="font-medium text-amber-600">{count(r.desired)}</span>
        </span>
      ),
    sort: r => r.desired - (r.pushedQty ?? 0),
  },
  {
    key: 'at',
    label: 'Last push',
    render: r =>
      r.pushError ? (
        <span title={r.pushError}>
          <Badge tone="red">Failed</Badge>
        </span>
      ) : r.pushedAt ? (
        when(r.pushedAt)
      ) : (
        <span className="text-foreground-muted">Never</span>
      ),
    sort: r => (r.pushError ? '0' : r.pushedAt ?? ''),
  },
  {
    key: 'price',
    label: 'Price',
    num: true,
    render: r =>
      drifted(r) ? (
        <span title={`Listed at ${money(r.listedPrice!)}, your price is ${money(r.ourPrice!)}. Change it on the portal.`}>
          {money(r.ourPrice!)} <Badge tone="amber">{money(r.listedPrice!)}</Badge>
        </span>
      ) : r.ourPrice == null ? (
        '-'
      ) : (
        money(r.ourPrice)
      ),
    sort: r => r.ourPrice ?? -1,
  },
]

/** Stock pushed to the marketplace: your stock less open orders and the safety buffer, per mapped listing. */
export default function InventoryPanel({ channel }: { channel: Channel }) {
  const name = LABEL[channel]
  const base = `/api/admin/${channel}/stock`
  const canWrite = useCanWrite(channel)
  const toast = useActionToast()
  const [data, setData] = useState<InventoryView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buffer, setBuffer] = useState('')
  const [busy, setBusy] = useState<'push' | 'buffer' | 'load' | null>(null)

  const load = useCallback(async () => {
    setBusy(b => b ?? 'load')
    const r = await api<InventoryView>(base)
    setBusy(b => (b === 'load' ? null : b))
    if (!r.ok) return setError(r.data.error || 'Could not load stock')
    setError(null)
    setData(r.data)
    setBuffer(String(r.data.buffer))
  }, [base])
  useEffect(() => {
    load()
  }, [load])

  async function push() {
    setBusy('push')
    const r = await api(base, { method: 'POST' })
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Could not push stock')
    const c = r.data?.counts ?? {}
    const failed = Number(c.failed ?? 0)
    toast.result({ ok: r.data?.status !== 'error', text: `Pushed ${count(Number(c.changed ?? 0))} change(s)${failed ? `; ${count(failed)} failed` : ''}.`, error: r.data?.errors?.[0]?.message }, { warning: failed > 0 })
    load()
  }

  async function saveBuffer() {
    const n = Number(buffer)
    if (!Number.isInteger(n) || n < 0 || n > 1000) return toast.error('The buffer is a whole number from 0 to 1000.')
    setBusy('buffer')
    const r = await api(base, { method: 'PUT', json: { buffer: n } })
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Could not save')
    toast.success(`${name} buffer set to ${n}. It applies from the next push.`)
    load()
  }

  if (error && !data) return <Banner ok={false}>{error}</Banner>
  if (!data) return <InventoryLoading />
  const t = data.totals
  const run = data.lastRun

  return (
    <div className="space-y-5">
      {error && <Banner ok={false}>{error}</Banner>}
      <KpiGrid>
        <Kpi label="Listings with stock" value={count(t.rows)} sub={data.warehouse ? `Warehouse ${data.warehouse}` : 'No warehouse set'} highlight />
        <Kpi label="Waiting to push" value={count(t.pending)} sub={data.lastPushAt ? `Last pushed ${when(data.lastPushAt)}` : 'Not pushed yet'} />
        <Kpi label="Push errors" value={count(t.errors)} />
        <Kpi label="Price differs" value={count(t.drift)} sub="Listed price is not your price" />
      </KpiGrid>

      <Section
        title="Stock on the marketplace"
        action={
          <div className="flex items-center gap-1">
            <IconButton icon={RefreshCw} label="Refresh" busy={busy === 'load'} onClick={load} />
            {canWrite && <IconButton icon={Upload} label="Push stock now" variant="accent" busy={busy === 'push'} disabled={!t.rows} onClick={push} />}
          </div>
        }
      >
        <p className="mb-3 text-xs text-foreground-muted">
          Every 10 minutes, and right after an order is accepted or cancelled, {name} gets each mapped listing&apos;s stock less units in orders not yet taken from stock and the buffer.
          Only listings whose number changed are sent. Out-of-stock or hidden products go as 0.
        </p>
        {!data.warehouse && <Banner ok={false}>Add your {name} warehouse ID in the connection settings (gear, top right); stock cannot be pushed without it.</Banner>}
        <div className="mt-3">
          <Table rows={data.rows} cols={COLS} rowKey={r => r.sku} empty={`No mapped listings yet. Map your products to ${name} SKUs on the Listings tab.`} />
        </div>
      </Section>

      <Section title="Safety buffer">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block sm:w-40">
            <span className="mb-1 block text-xs font-medium text-foreground-secondary">Units held back</span>
            <input type="number" min={0} max={1000} value={buffer} disabled={!canWrite} onChange={e => setBuffer(e.target.value)} className={inputCls} />
          </label>
          {canWrite && (
            <button type="button" className={btnGhost} disabled={busy === 'buffer' || buffer === String(data.buffer)} onClick={saveBuffer}>
              {busy === 'buffer' ? 'Saving…' : 'Save buffer'}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-foreground-muted">Held back from every listing so a sale on your store or another marketplace does not oversell here.</p>
        {run && (
          <p className="mt-3 text-xs text-foreground-muted">
            Last run {when(run.started_at)}: {run.status}
            {Object.entries(run.counts ?? {})
              .filter(([, v]) => v)
              .map(([k, v]) => ` · ${k} ${v}`)
              .join('')}
            {run.errors?.[0] ? ` · ${run.errors[0].message}` : ''}
          </p>
        )}
      </Section>
    </div>
  )
}
