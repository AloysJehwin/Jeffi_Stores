'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Images, Save, Search, Send, Upload } from 'lucide-react'
import AdminImage from '@/components/admin/AdminImage'
import AdminSelect from '@/components/admin/AdminSelect'
import IconButton from '@/components/ui/IconButton'
import { Badge, Banner, Section, Table, api, btnGhost, btnPrimary, inputCls, when, type Col, type Tone } from '@/components/admin/channels/ui'
import { Dialog } from '@/components/admin/kit/dialog'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { ListingStatus } from '@/lib/marketplace/catalog-load'
import type { ListingsPayload, ListingUnitView } from '@/lib/marketplace/catalog-routes'
import type { ColumnSource, TemplateMapping, TemplateSheet } from '@/lib/marketplace/catalog-export'
import type { ListingTaskRow, SkuReportField, SkuReportMatch } from '@/lib/marketplace/listings'
import { download, postForm } from './files'

type Channel = 'myntra' | 'ajio'
const LABEL: Record<Channel, string> = { myntra: 'Myntra', ajio: 'AJIO' }
const PAGE = 60

const STATUS_TONE: Record<ListingStatus, Tone> = { unmapped: 'muted', mapped: 'blue', submitted: 'amber', live: 'green', rejected: 'red', inactive: 'muted' }
const FILTERS = [
  { value: 'all', label: 'All units' },
  { value: 'unmapped', label: 'Not mapped' },
  { value: 'mapped', label: 'Mapped' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'live', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
]

const statusOf = (u: ListingUnitView): ListingStatus => u.listing?.status ?? 'unmapped'
const subtitle = (u: ListingUnitView) => [u.variantName, u.subVariantName].filter(Boolean).join(' · ')

/** Every sellable unit with its marketplace SKU / style ID: mapped by hand or from a SKU report,
 * exported into the portal's category template, photo packs, and API submission. */
export default function ListingsMapper({ channel }: { channel: Channel }) {
  const name = LABEL[channel]
  const base = `/api/admin/${channel}/listings`
  const canWrite = useCanWrite(channel)
  const toast = useActionToast()
  const [data, setData] = useState<ListingsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [edits, setEdits] = useState<Record<string, { marketplaceSku: string; styleId: string }>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'template' | 'images' | 'submit' | null>(null)
  const [report, setReport] = useState<{ file: File; preview: ReportPreview } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await api<ListingsPayload>(base)
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else setError(r.data.error || 'Could not load listings')
  }, [base])
  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.units ?? []).filter(u => {
      if (filter !== 'all' && statusOf(u) !== filter) return false
      if (!needle) return true
      return [u.name, u.variantName, u.subVariantName, u.ourSku, u.listing?.marketplaceSku, u.listing?.styleId].some(v => v?.toLowerCase().includes(needle))
    })
  }, [data, q, filter])

  const dirty = Object.keys(edits)
  const value = (u: ListingUnitView, k: 'marketplaceSku' | 'styleId') => edits[u.key]?.[k] ?? u.listing?.[k] ?? ''
  const edit = (u: ListingUnitView, k: 'marketplaceSku' | 'styleId', v: string) =>
    setEdits(e => {
      const next = { ...e, [u.key]: { marketplaceSku: value(u, 'marketplaceSku'), styleId: value(u, 'styleId'), [k]: v } }
      const n = next[u.key]
      if (n.marketplaceSku === (u.listing?.marketplaceSku ?? '') && n.styleId === (u.listing?.styleId ?? '')) delete next[u.key]
      return next
    })

  async function save() {
    setBusy('save')
    const r = await api(base, {
      method: 'PUT',
      json: { rows: dirty.map(key => ({ key, marketplaceSku: edits[key].marketplaceSku.trim() || null, styleId: edits[key].styleId.trim() || null })) },
    })
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Could not save')
    toast.success(`Saved ${r.data.saved} mapping(s).`)
    setEdits({})
    load()
  }

  async function uploadReport(file: File, columns?: Partial<Record<SkuReportField, string>>) {
    const form = new FormData()
    form.set('file', file)
    if (columns) form.set('columns', JSON.stringify(columns))
    setBusy('report')
    const r = await postForm<ReportPreview>(`${base}?action=report`, form)
    setBusy(null)
    if (!r.ok) return toast.error(r.data.error || 'Could not read the report')
    setReport({ file, preview: r.data })
  }

  const toggle = (key: string) =>
    setSelected(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const allShown = rows.length > 0 && rows.every(u => selected.has(u.key))
  const keys = [...selected]

  if (error) return <Banner ok={false}>{error}</Banner>
  if (!data) return <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />

  const counts = data.units.reduce<Record<string, number>>((m, u) => ((m[statusOf(u)] = (m[statusOf(u)] ?? 0) + 1), m), {})

  return (
    <div className="space-y-5">
      <Section
        title={`Listings (${data.units.length})`}
        action={
          canWrite ? (
            <div className="flex items-center gap-1">
              <IconButton icon={Upload} label="Upload SKU report" busy={busy === 'report'} onClick={() => fileRef.current?.click()} />
              <IconButton icon={FileSpreadsheet} label="Fill a listing template" disabled={!keys.length} onClick={() => setDialog('template')} />
              <IconButton icon={Images} label="Build image pack" disabled={!keys.length} onClick={() => setDialog('images')} />
              {data.submitSupported && <IconButton icon={Send} label={`Submit to ${name}`} disabled={!keys.length} onClick={() => setDialog('submit')} />}
              <IconButton icon={Save} label="Save changes" variant="accent" disabled={!dirty.length} busy={busy === 'save'} onClick={save} />
            </div>
          ) : undefined
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) uploadReport(f)
          }}
        />
        <p className="mb-3 text-xs text-foreground-muted">
          {counts.live ?? 0} live · {counts.mapped ?? 0} mapped · {counts.submitted ?? 0} submitted · {counts.rejected ?? 0} rejected · {counts.unmapped ?? 0} not mapped.
          Map each unit to its {name} SKU by hand, or upload the SKU report from the portal. Select units to fill a template, build an image pack
          {data.submitSupported ? ' or submit them' : ''}.
        </p>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input value={q} onChange={e => (setQ(e.target.value), setLimit(PAGE))} placeholder="Search name or SKU" className={`${inputCls} pl-9`} />
          </div>
          <div className="sm:w-48">
            <AdminSelect value={filter} options={FILTERS} onChange={v => (setFilter(v), setLimit(PAGE))} />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-muted">{data.units.length ? 'No units match.' : 'No sellable products yet.'}</p>
        ) : (
          <>
            <label className="mb-2 flex items-center gap-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                checked={allShown}
                onChange={() => setSelected(s => (allShown ? new Set([...s].filter(k => !rows.some(u => u.key === k))) : new Set([...s, ...rows.map(u => u.key)])))}
              />
              Select all {rows.length}
              {keys.length > 0 && <span>· {keys.length} selected</span>}
            </label>
            <ul className="divide-y divide-border-default/60 border-y border-border-default/60">
              {rows.slice(0, limit).map(u => (
                <UnitRow
                  key={u.key}
                  u={u}
                  name={name}
                  checked={selected.has(u.key)}
                  onCheck={() => toggle(u.key)}
                  sku={value(u, 'marketplaceSku')}
                  style={value(u, 'styleId')}
                  onEdit={(k, v) => edit(u, k, v)}
                  dirty={!!edits[u.key]}
                  canWrite={canWrite}
                />
              ))}
            </ul>
            {rows.length > limit && (
              <div className="mt-3 text-center">
                <button type="button" className={btnGhost} onClick={() => setLimit(l => l + PAGE)}>
                  Show more ({rows.length - limit} left)
                </button>
              </div>
            )}
          </>
        )}
      </Section>

      {data.tasks.length > 0 && (
        <Section title="Submissions">
          <Table rows={data.tasks} cols={TASK_COLS} rowKey={t => t.task_id} pageSize={10} />
        </Section>
      )}

      {report && (
        <ReportDialog
          channel={channel}
          report={report}
          busy={busy === 'report' || busy === 'apply'}
          onColumns={cols => uploadReport(report.file, cols)}
          onClose={() => setReport(null)}
          onApply={async () => {
            const form = new FormData()
            form.set('file', report.file)
            form.set('columns', JSON.stringify(report.preview.columns))
            form.set('apply', '1')
            setBusy('apply')
            const r = await postForm(`${base}?action=report`, form)
            setBusy(null)
            if (!r.ok) return toast.error(r.data.error || 'Could not save')
            toast.success(`Mapped ${r.data.saved ?? 0} unit(s) from the report.`)
            setReport(null)
            load()
          }}
        />
      )}
      {dialog === 'template' && <TemplateDialog channel={channel} keys={keys} categories={data.categories} attributeKeys={data.attributeKeys} onClose={() => setDialog(null)} />}
      {dialog === 'images' && (
        <ConfirmDialog
          title={`${name} image pack`}
          confirm="Build pack"
          busy={busy === 'images'}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            setBusy('images')
            const r = await download(`${base}/images`, { json: { keys } })
            setBusy(null)
            if (!r.ok) return toast.error(r.error || 'Could not build the pack')
            const failed = Number(r.headers?.get('x-failed') ?? 0)
            toast.result({ ok: !failed, text: `${r.headers?.get('x-images') ?? 0} photo(s) ready${failed ? `; ${failed} could not be read` : ''}.` }, { warning: !!failed })
            setDialog(null)
          }}
        >
          <p className="text-sm text-foreground-secondary">
            Photos of the {keys.length} selected unit(s), one folder per style (sizes share photos), up to {data.imageSpec.maxImages} each and {data.imageSpec.maxPerPack} per pack.
          </p>
          <p className="mt-2 text-xs text-foreground-muted">
            {channel === 'myntra'
              ? 'Each photo is padded onto a white 3:4 canvas of at least 1080x1440 and saved as a JPEG between 500 KB and 1 MB.'
              : 'Each photo is scaled so its short edge is at least 1000 px and uploaded; image-urls.csv in the zip lists the public links for the listing sheet.'}
          </p>
        </ConfirmDialog>
      )}
      {dialog === 'submit' && (
        <ConfirmDialog
          title={`Submit to ${name}`}
          confirm="Submit"
          busy={busy === 'submit'}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            setBusy('submit')
            const r = await api(`${base}/submit`, { method: 'POST', json: { keys } })
            setBusy(null)
            if (!r.ok) return toast.error(r.data.error || 'Could not submit')
            toast.success(`Submitted ${r.data.submitted ?? 0} listing(s) in ${r.data.tasks?.length ?? 0} batch(es)${r.data.skipped?.length ? `; ${r.data.skipped.length} skipped` : ''}.`)
            setDialog(null)
            setSelected(new Set())
            load()
          }}
        >
          <p className="text-sm text-foreground-secondary">
            Sends the {keys.length} selected unit(s) to {name}. Results arrive within minutes and show on each row; units without a mapping are submitted under your SKU.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function UnitRow({
  u,
  name,
  checked,
  onCheck,
  sku,
  style,
  onEdit,
  dirty,
  canWrite,
}: {
  u: ListingUnitView
  name: string
  checked: boolean
  onCheck: () => void
  sku: string
  style: string
  onEdit: (k: 'marketplaceSku' | 'styleId', v: string) => void
  dirty: boolean
  canWrite: boolean
}) {
  const status = statusOf(u)
  const drift = u.listing?.listedPrice != null && u.price != null && Math.abs(u.listing.listedPrice - u.price) >= 0.01
  return (
    <li className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] sm:items-center ${dirty ? 'bg-accent-500/5' : ''}`}>
      <input type="checkbox" className="mt-1 sm:mt-0" checked={checked} onChange={onCheck} aria-label={`Select ${u.name}`} />
      <div className="flex min-w-0 items-center gap-3">
        <AdminImage src={u.image} alt="" wrapperClassName="relative h-10 w-10 shrink-0 overflow-hidden rounded-md" className="h-full w-full object-cover" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{u.name}</p>
          <p className="truncate text-xs text-foreground-muted">
            {[subtitle(u), u.ourSku].filter(Boolean).join(' · ') || '-'}
            {u.imageCount ? ` · ${u.imageCount} photo${u.imageCount === 1 ? '' : 's'}` : ' · no photos'}
          </p>
        </div>
      </div>
      <input
        value={sku}
        onChange={e => onEdit('marketplaceSku', e.target.value)}
        disabled={!canWrite}
        placeholder={`${name} SKU`}
        aria-label={`${name} SKU for ${u.name}`}
        className={`${inputCls} col-start-2 sm:col-start-auto`}
      />
      <input
        value={style}
        onChange={e => onEdit('styleId', e.target.value)}
        disabled={!canWrite}
        placeholder="Style ID"
        aria-label={`Style ID for ${u.name}`}
        className={`${inputCls} col-start-2 sm:col-start-auto`}
      />
      <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto sm:justify-end">
        <span title={u.listing?.issues.join('\n') || undefined}>
          <Badge tone={STATUS_TONE[status]}>{status === 'unmapped' ? 'Not mapped' : status[0].toUpperCase() + status.slice(1)}</Badge>
        </span>
        {drift && (
          <span title={`Listed at ${u.listing!.listedPrice}, your price is ${u.price}`}>
            <Badge tone="amber">Price</Badge>
          </span>
        )}
      </div>
      {status === 'rejected' && u.listing?.issues.length ? <p className="col-start-2 text-xs text-red-500 sm:col-span-4">{u.listing.issues.slice(0, 3).join(' · ')}</p> : null}
    </li>
  )
}

const TASK_COLS: Col<ListingTaskRow>[] = [
  { key: 'task', label: 'Batch', render: t => <span className="font-mono text-xs">{t.task_id}</span> },
  { key: 'status', label: 'Status', render: t => <Badge tone={t.status === 'done' ? 'green' : t.status === 'failed' ? 'red' : 'amber'}>{t.status}</Badge> },
  { key: 'rows', label: 'Units', num: true, render: t => t.row_count },
  { key: 'ok', label: 'Live', num: true, render: t => t.success_count },
  { key: 'bad', label: 'Rejected', num: true, render: t => t.error_count },
  { key: 'at', label: 'Submitted', render: t => when(t.submitted_at) },
]

function ConfirmDialog({ title, confirm, busy, onClose, onConfirm, children }: { title: string; confirm: string; busy: boolean; onClose: () => void; onConfirm: () => void; children: React.ReactNode }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirm}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

// ── SKU report ──────────────────────────────────────────────────────────────

interface ReportPreview {
  headers: string[]
  columns: Partial<Record<SkuReportField, string>>
  matches: SkuReportMatch[]
  unmatched: string[]
  rows: number
}

const REPORT_FIELDS: { key: SkuReportField; label: string }[] = [
  { key: 'seller_sku', label: 'Your SKU (seller SKU)' },
  { key: 'marketplace_sku', label: 'Marketplace SKU' },
  { key: 'style_id', label: 'Style ID' },
  { key: 'listed_price', label: 'Selling price' },
  { key: 'listed_mrp', label: 'MRP' },
]

function ReportDialog({
  channel,
  report,
  busy,
  onColumns,
  onClose,
  onApply,
}: {
  channel: Channel
  report: { file: File; preview: ReportPreview }
  busy: boolean
  onColumns: (c: Partial<Record<SkuReportField, string>>) => void
  onClose: () => void
  onApply: () => void
}) {
  const p = report.preview
  const by = (c: SkuReportMatch['change']) => p.matches.filter(m => m.change === c).length
  const changes = by('new') + by('update')
  const options = [{ value: '', label: 'Not in this file' }, ...p.headers.map(h => ({ value: h, label: h }))]
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`${LABEL[channel]} SKU report`}
      description={`${report.file.name} · ${p.rows} rows`}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !changes} onClick={onApply}>
            {busy ? 'Working…' : `Map ${changes} unit(s)`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {REPORT_FIELDS.map(f => (
          <AdminSelect key={f.key} sm label={f.label} value={p.columns[f.key] ?? ''} options={options} disabled={busy} onChange={v => onColumns({ ...p.columns, [f.key]: v || undefined })} />
        ))}
      </div>
      <p className="mt-4 text-sm text-foreground">
        {by('new')} new · {by('update')} changed · {by('same')} unchanged · {p.unmatched.length} not in your catalogue
      </p>
      {p.matches.filter(m => m.change !== 'same').length > 0 && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-foreground-secondary">
          {p.matches
            .filter(m => m.change !== 'same')
            .slice(0, 50)
            .map(m => (
              <li key={m.key} className="truncate">
                <Badge tone={m.change === 'new' ? 'green' : 'amber'}>{m.change}</Badge> {m.label} → {m.marketplaceSku}
                {m.styleId ? ` (style ${m.styleId})` : ''}
              </li>
            ))}
        </ul>
      )}
      {p.unmatched.length > 0 && <p className="mt-3 break-words text-xs text-foreground-muted">Not matched: {p.unmatched.slice(0, 15).join(', ')}{p.unmatched.length > 15 ? '…' : ''}</p>}
    </Dialog>
  )
}

// ── Template export ─────────────────────────────────────────────────────────

interface InspectResult {
  sheets: (TemplateSheet & { suggested: Record<string, ColumnSource> })[]
  saved: (TemplateMapping & { updatedAt: string }) | null
  fields: { key: string; label: string }[]
}

const FIXED = '__fixed__'

function TemplateDialog({ channel, keys, categories, attributeKeys, onClose }: { channel: Channel; keys: string[]; categories: string[]; attributeKeys: string[]; onClose: () => void }) {
  const toast = useActionToast()
  const base = `/api/admin/${channel}/listings/export`
  const [category, setCategory] = useState(categories[0] ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<InspectResult | null>(null)
  const [sheet, setSheet] = useState('')
  const [dataStartRow, setDataStartRow] = useState(2)
  const [columns, setColumns] = useState<Record<string, ColumnSource>>({})
  const [busy, setBusy] = useState(false)

  const current = info?.sheets.find(s => s.name === sheet) ?? null

  function pick(i: InspectResult, name: string) {
    const s = i.sheets.find(x => x.name === name) ?? i.sheets[0]
    setSheet(s.name)
    const saved = i.saved && i.saved.sheet === s.name ? i.saved : null
    setDataStartRow(saved?.dataStartRow ?? s.dataStartRow)
    setColumns(saved?.columns ?? s.suggested)
  }

  async function inspect() {
    if (!file) return toast.error('Choose the blank template first.')
    const form = new FormData()
    form.set('file', file)
    form.set('category', category)
    form.set('attributeKeys', JSON.stringify(attributeKeys))
    setBusy(true)
    const r = await postForm<InspectResult>(`${base}?action=inspect`, form)
    setBusy(false)
    if (!r.ok) return toast.error(r.data.error || 'Could not read the template')
    setInfo(r.data)
    pick(r.data, r.data.saved?.sheet ?? r.data.sheets[0].name)
  }

  async function fill() {
    if (!file || !current) return
    const mapping: TemplateMapping = { sheet: current.name, headerRow: current.headerRow, dataStartRow, columns }
    const form = new FormData()
    form.set('file', file)
    form.set('category', category)
    form.set('mapping', JSON.stringify(mapping))
    form.set('keys', JSON.stringify(keys))
    setBusy(true)
    const r = await download(base, { body: form })
    setBusy(false)
    if (!r.ok) return toast.error(r.error || 'Could not fill the template')
    let blanks: Record<string, number> = {}
    try {
      blanks = JSON.parse(decodeURIComponent(r.headers?.get('x-blank-columns') ?? '%7B%7D'))
    } catch {}
    const empty = Object.keys(blanks)
    toast.result(
      { ok: !empty.length, text: `Filled ${r.headers?.get('x-rows') ?? keys.length} row(s).${empty.length ? ` Some cells were blank in: ${empty.slice(0, 4).join(', ')}${empty.length > 4 ? '…' : ''}.` : ''}` },
      { warning: !!empty.length }
    )
  }

  const sourceOptions = useMemo(
    () => [
      { value: '', label: 'Leave blank' },
      ...(info?.fields ?? []).map(f => ({ value: f.key, label: f.label, group: 'Catalogue' })),
      ...attributeKeys.map(k => ({ value: `attr:${k}`, label: k, group: 'Attributes' })),
      { value: FIXED, label: 'Fixed value…', group: 'Other' },
    ],
    [info, attributeKeys]
  )
  const setSource = (h: string, v: string) =>
    setColumns(c => {
      const next = { ...c }
      if (!v) delete next[h]
      else next[h] = v === FIXED ? { value: c[h]?.value ?? '' } : { field: v }
      return next
    })

  return (
    <Dialog
      open
      size="xl"
      dismissible={false}
      onClose={onClose}
      title={`Fill a ${LABEL[channel]} listing template`}
      description={`${keys.length} unit(s) selected, one row each. Upload the blank category template exactly as the portal gave it.`}
      footer={
        <>
          <button type="button" className={btnGhost} onClick={onClose}>
            Close
          </button>
          {info ? (
            <button type="button" className={btnPrimary} disabled={busy || !Object.keys(columns).length} onClick={fill}>
              {busy ? 'Working…' : 'Download filled template'}
            </button>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy || !file} onClick={inspect}>
              {busy ? 'Reading…' : 'Read columns'}
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-foreground-secondary">{LABEL[channel]} category</span>
          <input list={`${channel}-template-categories`} value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Tshirts" className={inputCls} />
          <datalist id={`${channel}-template-categories`}>
            {categories.map(c => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <span className="mt-1 block text-[11px] text-foreground-muted">The column mapping is saved under this name.</span>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-foreground-secondary">Blank template (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx"
            onChange={e => {
              setFile(e.target.files?.[0] ?? null)
              setInfo(null)
            }}
            className="block w-full min-w-0 text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border-default file:bg-surface file:px-3 file:py-1.5 file:text-sm"
          />
        </label>
      </div>
      {info && current && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {info.sheets.length > 1 && <AdminSelect sm label="Sheet" value={sheet} options={info.sheets.map(s => ({ value: s.name, label: s.name }))} onChange={v => pick(info, v)} />}
            <div>
              <span className="mb-1 block text-xs font-medium text-foreground-secondary">Header row</span>
              <p className="text-sm text-foreground">Row {current.headerRow}</p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-foreground-secondary">First data row</span>
              <input type="number" min={current.headerRow + 1} max={1000} value={dataStartRow} onChange={e => setDataStartRow(Math.max(current.headerRow + 1, Number(e.target.value) || current.headerRow + 1))} className={inputCls} />
            </label>
          </div>
          {info.saved && info.saved.sheet === current.name && <p className="text-xs text-foreground-muted">Using the mapping saved for {category} on {when(info.saved.updatedAt)}.</p>}
          <ul className="divide-y divide-border-default/60">
            {current.headers.map((h, i) =>
              h ? (
                <li key={`${i}:${h}`} className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                  <span className="min-w-0 break-words text-sm text-foreground">{h}</span>
                  <div className="flex min-w-0 gap-2">
                    <div className="min-w-0 flex-1">
                      <AdminSelect sm value={columns[h] ? (columns[h].value != null ? FIXED : columns[h].field ?? '') : ''} options={sourceOptions} onChange={v => setSource(h, v)} />
                    </div>
                    {columns[h]?.value != null && (
                      <input value={columns[h].value} onChange={e => setColumns(c => ({ ...c, [h]: { value: e.target.value } }))} placeholder="Value" className={`${inputCls} min-w-0 flex-1`} />
                    )}
                  </div>
                </li>
              ) : null
            )}
          </ul>
        </div>
      )}
    </Dialog>
  )
}
