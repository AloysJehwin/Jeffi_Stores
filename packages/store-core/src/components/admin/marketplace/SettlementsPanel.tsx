'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Upload, X } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import IconButton from '@/components/ui/IconButton'
import { Badge, Banner, Kpi, KpiGrid, RangePresets, Section, Table, api, btnGhost, btnPrimary, count, lastDays, money, when, type Col } from '@/components/admin/channels/ui'
import { Dialog } from '@/components/admin/kit/dialog'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { NormalizedLine, PayoutTotals, SettlementField, SettlementListRow, SettlementMapping, ChannelSettlementsView, UnsettledOrder } from '@/lib/marketplace/settlements'
import ColumnMapper from './ColumnMapper'
import { postForm } from './files'
import { Sk } from '@/components/admin/kit/skeleton'
import { SettlementsLoading } from './skeletons'

type Channel = 'myntra' | 'ajio'
const LABEL: Record<Channel, string> = { myntra: 'Myntra', ajio: 'AJIO' }
const OVERDUE_DAYS = 20

const fmtDate = (v: string | null) => (v ? new Date(`${v.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const cols = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

type Field = { key: SettlementField; label: string; multiple?: boolean; hint?: string }

const SETTLEMENT_COLS: Col<SettlementListRow>[] = [
  { key: 'date', label: 'Settled', render: r => fmtDate(r.settled_on), sort: r => r.settled_on ?? '' },
  {
    key: 'ref',
    label: 'Reference',
    render: r => (
      <span className="font-mono text-xs" title={r.file_name ?? undefined}>
        {r.settlement_ref}
      </span>
    ),
  },
  { key: 'gross', label: 'Sales', num: true, render: r => money(Number(r.gross)), sort: r => Number(r.gross) },
  { key: 'charges', label: 'Commission + fees', num: true, render: r => money(Number(r.commission) + Number(r.fees)), sort: r => Number(r.commission) + Number(r.fees) },
  { key: 'tax', label: 'TCS / TDS', num: true, render: r => money(Number(r.tax_withheld)), sort: r => Number(r.tax_withheld) },
  { key: 'refunds', label: 'Refunds', num: true, render: r => money(Number(r.refunds)), sort: r => Number(r.refunds) },
  { key: 'net', label: 'Settled', num: true, render: r => <span className="font-medium">{money(Number(r.net_amount))}</span>, sort: r => Number(r.net_amount) },
  {
    key: 'lines',
    label: 'Matched',
    num: true,
    render: r => (
      <span title={`${r.matched} of ${r.lines} line(s) matched to orders`}>
        {Number(r.lines) ? `${Math.round((Number(r.matched) / Number(r.lines)) * 100)}%` : '-'}
      </span>
    ),
    sort: r => (Number(r.lines) ? Number(r.matched) / Number(r.lines) : -1),
  },
]

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000) : null)

const UNSETTLED_COLS: Col<UnsettledOrder>[] = [
  { key: 'order', label: 'Order', render: r => <span className="font-mono text-xs">{r.order_number ?? r.external_order_id}</span> },
  { key: 'ext', label: 'Marketplace order', render: r => <span className="font-mono text-xs text-foreground-muted">{r.external_order_id}</span> },
  { key: 'total', label: 'Value', num: true, render: r => money(Number(r.total)), sort: r => Number(r.total) },
  {
    key: 'delivered',
    label: 'Delivered',
    render: r => {
      const d = daysSince(r.delivered_at)
      return (
        <span>
          {r.delivered_at ? when(r.delivered_at) : '-'}
          {d != null && d >= OVERDUE_DAYS && (
            <span className="ml-1.5">
              <Badge tone="red">{d} days</Badge>
            </span>
          )}
        </span>
      )
    },
    sort: r => r.delivered_at ?? '',
  },
]

/** Payouts imported from the portal's settlement reports, matched to orders, and what is still receivable. */
export default function SettlementsPanel({ channel }: { channel: Channel }) {
  const name = LABEL[channel]
  const base = `/api/admin/${channel}/settlements`
  const canWrite = useCanWrite(channel)
  const [range, setRange] = useState(() => lastDays(90))
  const [data, setData] = useState<(ChannelSettlementsView & { fields: Field[] }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api<ChannelSettlementsView & { fields: Field[] }>(`${base}?from=${range.from}&to=${range.to}`)
    setLoading(false)
    if (!r.ok) return setError(r.data.error || 'Could not load settlements')
    setError(null)
    setData(r.data)
  }, [base, range])
  useEffect(() => {
    load()
  }, [load])

  if (error && !data) return <Banner ok={false}>{error}</Banner>
  if (!data) return <SettlementsLoading />
  const t = data.totals
  const rec = data.receivable

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RangePresets value={range} onChange={setRange} presets={[30, 90, 180, 365]} />
        <div className="flex items-center gap-1">
          <IconButton icon={RefreshCw} label="Refresh" busy={loading} onClick={load} />
          {canWrite && <IconButton icon={Upload} label="Import a settlement report" variant="accent" onClick={() => fileRef.current?.click()} />}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setFile(f)
          }}
        />
      </div>
      {error && <Banner ok={false}>{error}</Banner>}

      <KpiGrid>
        <Kpi label="Settled to bank" value={money(t.net)} sub={`${count(t.count)} payout(s) in this period`} highlight />
        <Kpi label="Commission + fees" value={money(t.commission + t.fees)} sub={t.gross ? `${((100 * (t.commission + t.fees)) / t.gross).toFixed(1)}% of sales` : undefined} />
        <Kpi label="TCS / TDS" value={money(t.tax)} sub="Claim against your GST and income tax" />
        <Kpi
          label="Receivable"
          value={money(rec.unsettledValue)}
          sub={rec.overdueOrders ? `${count(rec.overdueOrders)} order(s) unsettled ${OVERDUE_DAYS}+ days` : `${count(rec.unsettledOrders)} delivered order(s) not yet settled`}
        />
      </KpiGrid>

      <Section title="Payouts">
        <Table rows={data.settlements} cols={SETTLEMENT_COLS} rowKey={r => r.id} empty={`No ${name} payouts in this period. Import the settlement report from the ${name} seller portal.`} />
        <p className="mt-3 text-xs text-foreground-muted">
          Download the payment / settlement report from the {name} seller portal and import it here. Re-importing the same payout replaces it, so overlapping reports are safe.
          {data.mapping ? ' The column mapping from your last import is reused.' : ''}
        </p>
      </Section>

      <Section title={`Delivered, not settled (${count(rec.unsettledOrders)})`}>
        <Table rows={data.unsettled} cols={UNSETTLED_COLS} rowKey={r => r.external_order_id} empty="Every delivered order has a settlement line." />
        {rec.oldestUnsettledAt && <p className="mt-3 text-xs text-foreground-muted">Oldest unsettled delivery: {when(rec.oldestUnsettledAt)}.</p>}
      </Section>

      {file && (
        <ImportDialog
          channel={channel}
          file={file}
          onClose={() => setFile(null)}
          onDone={() => {
            setFile(null)
            load()
          }}
        />
      )}
    </div>
  )
}

interface ImportPreview {
  fields: Field[]
  headers: string[]
  mapping: SettlementMapping
  problems: string[]
  rows: number
  samples: Record<string, string>
  preview: Omit<NormalizedLine, 'raw'>[]
  errors: { row: number; message: string }[]
  payouts: PayoutTotals[]
}

const PREVIEW_COLS: Col<Omit<NormalizedLine, 'raw'>>[] = [
  { key: 'row', label: 'Row', num: true, render: l => l.rowNumber },
  { key: 'type', label: 'Type', render: l => <Badge tone={l.lineType === 'sale' ? 'green' : l.lineType === 'refund' ? 'red' : 'muted'}>{l.lineType}</Badge> },
  { key: 'order', label: 'Order', render: l => <span className="font-mono text-xs">{l.externalOrderId ?? '-'}</span> },
  { key: 'gross', label: 'Sale', num: true, render: l => money(l.gross) },
  { key: 'charges', label: 'Charges', num: true, render: l => money(l.commission + l.fees + l.taxWithheld) },
  { key: 'net', label: 'Net', num: true, render: l => money(l.net) },
]

function ImportDialog({ channel, file, onClose, onDone }: { channel: Channel; file: File; onClose: () => void; onDone: () => void }) {
  const toast = useActionToast()
  const url = `/api/admin/${channel}/settlements/import`
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<SettlementMapping>({})
  const [checked, setChecked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (m: SettlementMapping | null, commit = false) => {
      const form = new FormData()
      form.set('file', file)
      if (m) form.set('mapping', JSON.stringify(m))
      if (commit) form.set('commit', '1')
      setBusy(true)
      const r = await postForm<ImportPreview & { ok?: boolean; settlements?: number; lines?: number; matched?: number }>(url, form)
      setBusy(false)
      return r
    },
    [file, url]
  )

  const check = useCallback(
    async (m: SettlementMapping | null) => {
      const r = await run(m)
      if (!r.ok) return setError(r.data.error || 'Could not read the report')
      setError(null)
      setPreview(r.data)
      setMapping(r.data.mapping)
      setChecked(JSON.stringify(r.data.mapping))
    },
    [run]
  )
  useEffect(() => {
    check(null)
  }, [check])

  async function commit() {
    const r = await run(mapping, true)
    if (!r.ok) return toast.error(r.data.error || 'Could not import')
    const d = r.data
    toast.result(
      { ok: true, text: `Imported ${count(d.lines ?? 0)} line(s) in ${count(d.settlements ?? 0)} payout(s); ${count(d.matched ?? 0)} matched to orders.` },
      { warning: (d.matched ?? 0) < (d.lines ?? 0) }
    )
    onDone()
  }

  const fields = preview?.fields ?? []
  const first: Record<string, string | null> = Object.fromEntries(fields.map(f => [f.key, cols(mapping[f.key])[0] ?? null]))
  const onFirst = (next: Record<string, string | null>) =>
    setMapping(prev => {
      const out: SettlementMapping = {}
      for (const f of fields) {
        const head = next[f.key]
        const rest = f.multiple ? cols(prev[f.key]).slice(1).filter(c => c !== head) : []
        const all = head ? [head, ...rest] : rest
        if (all.length) out[f.key] = f.multiple ? all : all[0]
      }
      return out
    })
  const extra = (key: SettlementField, change: (list: string[]) => string[]) =>
    setMapping(prev => {
      const list = change(cols(prev[key]))
      const out = { ...prev }
      if (list.length) out[key] = list
      else delete out[key]
      return out
    })
  const dirty = JSON.stringify(mapping) !== checked
  const p = preview
  const multi = fields.filter(f => f.multiple && cols(mapping[f.key]).length)

  return (
    <Dialog
      open
      size="xl"
      dismissible={false}
      onClose={onClose}
      title={`Import a ${LABEL[channel]} settlement report`}
      description={`${file.name}${p ? ` · ${count(p.rows)} rows` : ''}`}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          {dirty ? (
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => check(mapping)}>
              {busy ? 'Checking…' : 'Check mapping'}
            </button>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy || !p || p.problems.length > 0 || !p.payouts.length} onClick={commit}>
              {busy ? 'Working…' : `Import ${count(p?.payouts.length ?? 0)} payout(s)`}
            </button>
          )}
        </>
      }
    >
      {error && <Banner ok={false}>{error}</Banner>}
      {!p ? (
        !error && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Sk className="h-3 w-24" />
                <Sk className="h-control rounded-lg" />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs text-foreground-muted">Match the report&apos;s columns to ours. Amounts may come from several columns; add the rest under the first one.</p>
            <ColumnMapper fields={fields} headers={p.headers} value={first} onChange={onFirst} samples={p.samples} disabled={busy} />
          </div>
          {multi.length > 0 && (
            <div className="space-y-2">
              {multi.map(f => {
                const list = cols(mapping[f.key])
                const left = p.headers.filter(h => !list.includes(h))
                return (
                  <div key={f.key} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground-secondary">{f.label}:</span>
                    {list.map((c, i) => (
                      <span key={c} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-0.5 text-xs">
                        <span className="truncate">{c}</span>
                        {i > 0 && (
                          <button type="button" aria-label={`Remove ${c}`} className="text-foreground-muted hover:text-foreground" onClick={() => extra(f.key, l => l.filter(x => x !== c))}>
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {left.length > 0 && (
                      <div className="w-full sm:w-56">
                        <AdminSelect xs value="" placeholder="Add a column" options={[{ value: '', label: 'Add a column' }, ...left.map(h => ({ value: h, label: h }))]} onChange={v => v && extra(f.key, l => [...l, v])} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {dirty ? (
            <p className="text-sm text-foreground-muted">Check the mapping to see the payouts it produces.</p>
          ) : (
            <>
              {p.problems.length > 0 && <Banner ok={false}>{p.problems.join(' ')}</Banner>}
              {p.payouts.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">
                    {count(p.payouts.length)} payout(s), {money(p.payouts.reduce((s, x) => s + x.net, 0))} settled
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-foreground-secondary">
                    {p.payouts.slice(0, 30).map(x => (
                      <li key={x.ref} className="flex flex-wrap justify-between gap-2">
                        <span className="min-w-0 truncate font-mono">{x.ref}</span>
                        <span>
                          {count(x.lines)} line(s) · {money(x.gross)} sales · {money(x.commission + x.fees)} charges · <span className="font-medium text-foreground">{money(x.net)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.preview.length > 0 && <Table rows={p.preview} cols={PREVIEW_COLS} rowKey={l => String(l.rowNumber)} />}
              {p.errors.length > 0 && (
                <p className="text-xs text-amber-600">
                  {p.errors.length} row(s) skipped: {p.errors.slice(0, 3).map(e => `row ${e.row}: ${e.message}`).join('; ')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}
