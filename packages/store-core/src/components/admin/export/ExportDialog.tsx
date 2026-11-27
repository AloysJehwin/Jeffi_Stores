'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText, FileType2, GripVertical, Loader2, Presentation, RotateCcw, Save, Trash2 } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import AdminSelect from '@/components/admin/AdminSelect'
import { Dialog } from '@/components/admin/kit/dialog'
import { useActionToast } from '@/components/admin/kit/toast'
import {
  BRANDING_BY_FORMAT,
  BRANDING_LABELS,
  FORMAT_LABELS,
  SCOPE_LABELS,
  defaultColumns,
  sanitizeOptions,
  type BrandingOptions,
  type DateRange,
  type ExportFormat,
  type ExportOptions,
  type ExportPreset,
  type ExportSchema,
  type ExportScope,
  type FilterValues,
} from '@/lib/export/types'
import { useExportRowsSnapshot } from './export-rows'

export interface ExportDialogProps {
  open: boolean
  onClose: () => void
  exportKey: string
  /** The page's query string (filters, search, sort); defaults to none. */
  query?: string
  /** The page's own period, when it keeps one outside the URL. */
  range?: DateRange
  /** Include/exclude values the page already narrowed (e.g. the GST page's ticked sources). */
  filters?: FilterValues
  /** Data the page already holds, for `clientRows` exports. */
  rows?: unknown[]
}

const FORMAT_ICON: Record<ExportFormat, typeof FileText> = { csv: FileText, xlsx: FileSpreadsheet, pdf: FileType2, pptx: Presentation }
const FORMAT_HINT: Record<ExportFormat, string> = { csv: 'Plain rows', xlsx: 'Formatted sheets', pdf: 'Print-ready', pptx: 'Slides' }

const box = 'rounded-lg border border-border-default'
const chk = 'h-4 w-4 shrink-0 accent-accent-500'

function Section({ title, hint, open, onToggle, children }: { title: string; hint?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={box}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
          <span className="truncate">{hint}</span>
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </span>
      </button>
      {open && <div className="border-t border-border-default p-3">{children}</div>}
    </section>
  )
}

function filenameOf(res: Response, fallback: string) {
  const cd = res.headers.get('Content-Disposition') ?? ''
  return /filename="([^"]+)"/.exec(cd)?.[1] ?? fallback
}

/** The standard export dialog: defaults preselected so one click exports, every choice adjustable. */
export function ExportDialog({ open, onClose, exportKey, query = '', range, filters, rows: clientRows }: ExportDialogProps) {
  const toast = useActionToast()
  const rows = useExportRowsSnapshot(exportKey)
  const [schema, setSchema] = useState<ExportSchema | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [opts, setOpts] = useState<ExportOptions | null>(null)
  const [presetId, setPresetId] = useState<string>('last')
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [count, setCount] = useState<{ sig: string; n: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ include: true })
  const [drag, setDrag] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const base = `/api/admin/export/${encodeURIComponent(exportKey)}`

  const available = useCallback(
    (s: ExportScope) => (s === 'page' ? !!rows.page?.length : s === 'selected' ? !!rows.selected?.length : true),
    [rows.page?.length, rows.selected?.length]
  )

  /** A preset (or the defaults) with the page's own period, filters and scope applied over it. */
  const withPage = useCallback(
    (s: ExportSchema, o: ExportOptions): ExportOptions => {
      const next = sanitizeOptions(s, { ...o, range: range ?? s.range ?? s.defaults.range, filters: { ...o.filters, ...(filters ?? {}) } })
      if (!s.scopes.includes(next.scope) || !available(next.scope)) next.scope = s.scopes.includes('filtered') ? 'filtered' : s.scopes[0]
      if (rows.selected?.length && s.scopes.includes('selected')) next.scope = 'selected'
      return next
    },
    [range, filters, available, rows.selected?.length]
  )

  useEffect(() => {
    if (!open) return
    let live = true
    setSchema(null)
    setLoadError(null)
    fetch(`${base}?q=${encodeURIComponent(query)}`, { credentials: 'include' })
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!live) return
        if (!r.ok) return setLoadError(data.error || 'Could not load the export options')
        const s = data as ExportSchema
        setSchema(s)
        setPresets(s.presets)
        setPresetId(s.last ? 'last' : 'defaults')
        setOpts(withPage(s, s.last ?? s.defaults))
      })
      .catch(() => live && setLoadError('Could not load the export options'))
    return () => {
      live = false
    }
    // Loads once per opening; page state is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base])

  const context = useMemo(() => ({ query, pageIds: rows.page, selectedIds: rows.selected, rows: clientRows }), [query, rows.page, rows.selected, clientRows])
  const countSig = opts ? JSON.stringify([opts.scope, opts.filters, opts.range, opts.format, opts.scope === 'page' ? rows.page?.length : opts.scope === 'selected' ? rows.selected?.length : 0]) : ''

  useEffect(() => {
    if (!open || !opts || !schema) return
    if (opts.scope === 'page' || opts.scope === 'selected') {
      setCount({ sig: countSig, n: (opts.scope === 'page' ? rows.page : rows.selected)?.length ?? 0 })
      return
    }
    let live = true
    const t = setTimeout(() => {
      fetch(base, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'count', options: opts, context }) })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => live && setCount({ sig: countSig, n: ok && typeof d.count === 'number' ? d.count : null }))
        .catch(() => live && setCount({ sig: countSig, n: null }))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
    // countSig captures the options that change the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, countSig, schema])

  const set = (patch: Partial<ExportOptions>) => setOpts(o => (o ? { ...o, ...patch } : o))
  const toggle = (k: string) => setOpenSec(s => ({ ...s, [k]: !s[k] }))

  const applyPreset = (id: string) => {
    if (!schema) return
    setPresetId(id)
    const p = id === 'defaults' ? schema.defaults : id === 'last' ? (schema.last ?? schema.defaults) : presets.find(x => x.id === id)?.options
    if (p) setOpts(withPage(schema, p))
  }

  const savePreset = async () => {
    if (!opts || !naming?.trim()) return
    const r = await fetch(base, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: naming.trim(), options: opts }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(d.error || 'Could not save the preset')
    setPresets(ps => [...ps.filter(p => p.id !== d.preset.id), d.preset].sort((a, b) => a.name.localeCompare(b.name)))
    setPresetId(d.preset.id)
    setNaming(null)
    toast.success(`Saved preset “${d.preset.name}”`)
  }

  const deletePreset = async () => {
    const p = presets.find(x => x.id === presetId)
    if (!p) return
    const r = await fetch(`${base}?id=${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) return toast.error('Could not delete the preset')
    setPresets(ps => ps.filter(x => x.id !== p.id))
    setPresetId('defaults')
    toast.success(`Deleted preset “${p.name}”`)
  }

  const run = async () => {
    if (!opts || !schema) return
    setBusy(true)
    setError(null)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const res = await fetch(base, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export', options: opts, context }), signal: ctl.signal })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filenameOf(res, `${exportKey}.${opts.format}`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success(`Exported ${schema.title} (${FORMAT_LABELS[opts.format]})`)
      onClose()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Export failed')
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  const close = () => {
    abort.current?.abort()
    onClose()
  }

  const cols = schema && opts ? schema.columns : []
  const byKey = new Map(cols.map(c => [c.key, c]))
  const picked = opts ? opts.columns.filter(k => byKey.has(k)) : []
  const ordered = opts ? [...picked, ...cols.map(c => c.key).filter(k => !picked.includes(k))] : []
  const move = (from: number, to: number) => {
    if (!opts || to < 0 || to >= ordered.length || from === to) return
    const next = [...ordered]
    const [k] = next.splice(from, 1)
    next.splice(to, 0, k)
    set({ columns: next.filter(x => picked.includes(x)) })
  }
  const flip = (k: string) => {
    if (!opts) return
    const on = picked.includes(k)
    set({ columns: on ? picked.filter(x => x !== k) : ordered.filter(x => x === k || picked.includes(x)) })
  }

  const n = count && count.sig === countSig ? count.n : undefined
  const cap = schema && opts ? schema.caps[opts.format] : 0
  const capped = typeof n === 'number' && n > cap
  const noun = schema?.noun.toLowerCase() ?? 'rows'
  const nothing = picked.length === 0
  const label = !opts ? 'Export' : `Export${typeof n === 'number' ? ` ${Math.min(n, cap).toLocaleString('en-IN')} ${noun}` : ''} · ${FORMAT_LABELS[opts.format]}`

  const brandKeys = opts ? BRANDING_BY_FORMAT[opts.format] : []
  const brandOn = opts ? brandKeys.filter(k => opts.branding[k]).length : 0

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={schema ? `Export ${schema.title}` : 'Export'}
      description={schema ? 'Defaults are ready: export now, or adjust any choice below.' : undefined}
      footer={
        <>
          {error && <p className="mr-auto text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={close} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
            Cancel
          </button>
          <button type="button" onClick={run} disabled={!opts || busy || nothing} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? 'Preparing…' : label}
          </button>
        </>
      }
    >
      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : !schema || !opts ? (
        <p className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading export options…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground-muted">Preset</span>
            <AdminSelect
              sm
              ariaLabel="Preset"
              className="min-w-0 flex-1"
              value={presetId}
              onChange={applyPreset}
              options={[...(schema.last ? [{ value: 'last', label: 'Last used' }] : []), { value: 'defaults', label: 'Defaults' }, ...presets.map(p => ({ value: p.id, label: p.name }))]}
            />
            {naming == null ? (
              <button type="button" onClick={() => setNaming('')} className="control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary" title="Save these choices as a named preset">
                <Save className="h-3.5 w-3.5" /> Save as…
              </button>
            ) : (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={naming}
                  maxLength={80}
                  onChange={e => setNaming(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void savePreset()
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setNaming(null)
                    }
                  }}
                  placeholder="Preset name"
                  aria-label="Preset name"
                  className="control-sm w-40 rounded-lg border border-border-default bg-surface-elevated px-2 text-sm"
                />
                <button type="button" onClick={() => void savePreset()} disabled={!naming.trim()} className="control-sm bg-accent-500 text-white disabled:opacity-40">
                  Save
                </button>
              </span>
            )}
            {presets.some(p => p.id === presetId) && (
              <button type="button" onClick={() => void deletePreset()} aria-label="Delete preset" title="Delete this preset" className="control-sm control-icon text-foreground-muted hover:bg-surface-secondary hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Format</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {schema.formats.map(f => {
                const Icon = FORMAT_ICON[f]
                const on = opts.format === f
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ format: f })}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors ${on ? 'border-accent-500 bg-accent-500/5 ring-1 ring-accent-500' : 'border-border-default hover:bg-surface-secondary'}`}
                  >
                    <Icon className={`h-5 w-5 ${on ? 'text-accent-600' : 'text-foreground-muted'}`} />
                    <span className="text-sm font-medium text-foreground">{FORMAT_LABELS[f]}</span>
                    <span className="text-[11px] text-foreground-muted">{FORMAT_HINT[f]}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {schema.scopes.length > 1 && (
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Rows</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {schema.scopes.map(s => {
                  const ok = available(s)
                  const k = s === 'page' ? rows.page?.length : s === 'selected' ? rows.selected?.length : undefined
                  return (
                    <label key={s} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${opts.scope === s ? 'border-accent-500 bg-accent-500/5' : 'border-border-default'} ${ok ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                      <input type="radio" name="export-scope" checked={opts.scope === s} disabled={!ok} onChange={() => set({ scope: s })} className={chk} />
                      <span className="text-foreground">{SCOPE_LABELS[s]}</span>
                      {k != null && <span className="ml-auto text-xs text-foreground-muted">{k.toLocaleString('en-IN')}</span>}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}

          {schema.dateRange && (
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">{schema.dateRange.label}</legend>
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={opts.range?.from ?? ''} onChange={v => set({ range: { ...opts.range, from: v || undefined } })} clearable aria-label="From" placeholder="From" />
                <span className="text-sm text-foreground-muted">to</span>
                <DatePicker value={opts.range?.to ?? ''} onChange={v => set({ range: { ...opts.range, to: v || undefined } })} clearable aria-label="To" placeholder="To" min={opts.range?.from} />
              </div>
            </fieldset>
          )}

          <p className="text-sm text-foreground-secondary" aria-live="polite">
            {n === undefined ? (
              <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting {noun}…
              </span>
            ) : n === null ? null : n === 0 ? (
              `No ${noun} match these choices.`
            ) : (
              `${n.toLocaleString('en-IN')} ${noun} will be exported.`
            )}
            {capped && <span className="ml-1 text-amber-600 dark:text-amber-400">{FORMAT_LABELS[opts.format]} holds the first {cap.toLocaleString('en-IN')}; pick CSV or Excel, or narrow the filters, for the rest.</span>}
          </p>

          {schema.filters.length > 0 && (
            <Section title="Include" hint={`${schema.filters.length} choice${schema.filters.length > 1 ? 's' : ''}`} open={!!openSec.include} onToggle={() => toggle('include')}>
              <div className="space-y-3">
                {schema.filters.map(f =>
                  f.kind === 'toggle' ? (
                    <label key={f.key} className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={opts.filters[f.key] === true} onChange={e => set({ filters: { ...opts.filters, [f.key]: e.target.checked } })} className={chk} />
                      {f.label}
                    </label>
                  ) : (
                    <div key={f.key}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground-secondary">{f.label}</span>
                        <span className="flex gap-2 text-xs">
                          <button type="button" className="text-accent-600 hover:underline" onClick={() => set({ filters: { ...opts.filters, [f.key]: (f.options ?? []).map(o => o.value) } })}>
                            All
                          </button>
                          <button type="button" className="text-accent-600 hover:underline" onClick={() => set({ filters: { ...opts.filters, [f.key]: [] } })}>
                            None
                          </button>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(f.options ?? []).map(o => {
                          const vals = (opts.filters[f.key] as string[]) ?? []
                          const on = vals.includes(o.value)
                          return (
                            <label key={o.value} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-accent-500 bg-accent-500/10 text-foreground' : 'border-border-default text-foreground-muted line-through'}`}>
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={on}
                                onChange={() => set({ filters: { ...opts.filters, [f.key]: on ? vals.filter(v => v !== o.value) : [...vals, o.value] } })}
                              />
                              {o.label}
                            </label>
                          )
                        })}
                      </div>
                      {f.help && <p className="mt-1 text-[11px] text-foreground-muted">{f.help}</p>}
                    </div>
                  )
                )}
              </div>
            </Section>
          )}

          <Section title="Columns" hint={`${picked.length} of ${cols.length}`} open={!!openSec.columns} onToggle={() => toggle('columns')}>
            <div className="mb-2 flex flex-wrap gap-3 text-xs">
              <button type="button" className="text-accent-600 hover:underline" onClick={() => set({ columns: ordered })}>
                Select all
              </button>
              <button type="button" className="text-accent-600 hover:underline" onClick={() => set({ columns: ordered.filter(k => byKey.get(k)?.id) })}>
                Key columns only
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-accent-600 hover:underline" onClick={() => set({ columns: defaultColumns(cols) })}>
                <RotateCcw className="h-3 w-3" /> Reset order
              </button>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {ordered.map((k, i) => {
                const c = byKey.get(k)!
                const on = picked.includes(k)
                return (
                  <li
                    key={k}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      if (drag != null) move(drag, i)
                      setDrag(null)
                    }}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${drag === i ? 'border-accent-500' : 'border-transparent hover:border-border-default'}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-foreground-muted" aria-hidden />
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={on} onChange={() => flip(k)} className={chk} />
                      <span className={`truncate ${on ? 'text-foreground' : 'text-foreground-muted'}`}>{c.label}</span>
                      {c.id && <span className="shrink-0 rounded bg-surface-secondary px-1.5 text-[10px] uppercase tracking-wide text-foreground-muted">key</span>}
                    </label>
                    <button type="button" aria-label={`Move ${c.label} up`} disabled={!on || i === 0} onClick={() => move(i, i - 1)} className="control-sm control-icon text-foreground-muted hover:bg-surface-secondary disabled:opacity-30">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${c.label} down`} disabled={!on || i >= picked.length - 1} onClick={() => move(i, i + 1)} className="control-sm control-icon text-foreground-muted hover:bg-surface-secondary disabled:opacity-30">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-[11px] text-foreground-muted">Some reports add fixed tables (summaries, HSN) after the columns you pick.</p>
          </Section>

          <Section title="Header & branding" hint={`${brandOn} of ${brandKeys.length} on`} open={!!openSec.branding} onToggle={() => toggle('branding')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {brandKeys.map(k => {
                const child = k !== 'header' && k !== 'summary' && k !== 'pageNumbers' && k !== 'generatedBy'
                const disabled = child && !opts.branding.header
                return (
                  <label key={k} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40' : 'text-foreground'}`}>
                    <input
                      type="checkbox"
                      checked={opts.branding[k]}
                      disabled={disabled}
                      onChange={e => set({ branding: { ...opts.branding, [k]: e.target.checked } as BrandingOptions })}
                      className={chk}
                    />
                    {k === 'header' ? (opts.format === 'pptx' ? 'Title slide' : opts.format === 'pdf' ? 'Letterhead' : 'Header block') : BRANDING_LABELS[k]}
                  </label>
                )
              })}
            </div>
          </Section>
        </div>
      )}
    </Dialog>
  )
}
