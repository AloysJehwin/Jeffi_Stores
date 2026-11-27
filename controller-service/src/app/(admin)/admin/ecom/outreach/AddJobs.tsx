'use client'

import { useMemo, useRef, useState } from 'react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import { REF_TYPES, type InputSpec } from '@controller/lib/outreach/agent/types'
import { API, LANGUAGE_LABEL } from './shared'

type Mode = 'form' | 'import' | 'api' | 'test'
const MODES: { id: Mode; label: string }[] = [
  { id: 'form', label: 'Single job' },
  { id: 'import', label: 'CSV / XLSX' },
  { id: 'api', label: 'API' },
  { id: 'test', label: 'Test job' },
]

const REF_HINT: Record<string, string> = {
  order_ref: 'Order number',
  checkout_ref: 'Checkout key (cart:… or order:…)',
  product_ref: 'Product id or slug',
  customer_ref: 'Customer id',
}

const SAMPLE: Record<string, unknown> = {
  phone: '+919876543210', text: 'text', email: 'name@example.com', number: 1, money: 499, date: '2026-12-01', datetime: '2026-12-01T10:00:00+05:30',
  url: 'https://example.com', boolean: true, language: 'en', order_ref: '1001', checkout_ref: 'cart:<user id>', product_ref: '<product id>', customer_ref: '<customer id>',
}
const sampleOf = (s: InputSpec) => (s.type === 'enum' ? s.enum?.[0] ?? 'value' : SAMPLE[s.type] ?? 'value')
const ROLE_NOTE = (s: InputSpec) => (s.role === 'contact' ? 'The number the agent reaches' : s.role === 'name' ? 'Their name' : s.role === 'language' ? 'Their language' : null)

/** Parses the first line of a CSV (quote-aware). XLSX headers cannot be read here. */
function csvHeaders(text: string): string[] {
  const line = text.replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur.trim()); cur = '' }
    else cur += c
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

type RowResult = { ok: boolean; created: boolean; jobId?: string; errors: string[] }

/** The inputs rendered as a form: phone, text, datetime, enum -> select, boolean -> checkbox, refs -> text with a hint. */
function InputsForm({ inputs, submitLabel, busy, disabled, withDue, onSubmit }: {
  inputs: Record<string, InputSpec>
  submitLabel: string
  busy: boolean
  disabled: boolean
  withDue?: boolean
  onSubmit: (inputs: Record<string, unknown>, dueAt?: string) => void
}) {
  const [vals, setVals] = useState<Record<string, string | boolean>>({})
  const [due, setDue] = useState('')
  const entries = Object.entries(inputs)
  const set = (k: string, v: string | boolean) => setVals(cur => ({ ...cur, [k]: v }))
  const missing = entries.filter(([k, s]) => s.required && s.type !== 'boolean' && !String(vals[k] ?? '').trim()).map(([k]) => k)

  function submit() {
    const out: Record<string, unknown> = {}
    for (const [k, s] of entries) {
      const v = vals[k]
      if (s.type === 'boolean') {
        if (v) out[k] = true
      } else if (typeof v === 'string' && v.trim()) {
        out[k] = s.type === 'datetime' ? new Date(v).toISOString() : s.type === 'number' || s.type === 'money' ? Number(v) : v.trim()
      }
    }
    onSubmit(out, due ? new Date(due).toISOString() : undefined)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map(([k, s]) => {
          const label = (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono">{k}</span>
              {s.required && <Badge tone="blue">Required</Badge>}
            </span>
          )
          const hint = s.description || ROLE_NOTE(s) || (REF_TYPES.includes(s.type) ? REF_HINT[s.type] : null)
          let field: React.ReactNode
          if (s.type === 'boolean')
            field = (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={!!vals[k]} onChange={e => set(k, e.target.checked)} />
                Yes
              </label>
            )
          else if (s.type === 'enum')
            field = (
              <select className={inputCls} value={String(vals[k] ?? '')} onChange={e => set(k, e.target.value)}>
                <option value="">Choose…</option>
                {(s.enum ?? []).map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )
          else if (s.type === 'language')
            field = (
              <select className={inputCls} value={String(vals[k] ?? '')} onChange={e => set(k, e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(LANGUAGE_LABEL).map(([c, l]) => (
                  <option key={c} value={c}>{l}</option>
                ))}
              </select>
            )
          else {
            const type = s.type === 'datetime' ? 'datetime-local' : s.type === 'date' ? 'date' : s.type === 'number' || s.type === 'money' ? 'number' : s.type === 'email' ? 'email' : s.type === 'url' ? 'url' : 'text'
            field = (
              <input
                className={inputCls}
                type={type}
                inputMode={s.type === 'phone' ? 'tel' : undefined}
                placeholder={s.type === 'phone' ? '+91…' : REF_TYPES.includes(s.type) ? REF_HINT[s.type] : undefined}
                value={String(vals[k] ?? '')}
                onChange={e => set(k, e.target.value)}
              />
            )
          }
          return (
            <label key={k} className="text-xs text-foreground-muted space-y-1 block">
              {label}
              {field}
              {hint && <span className="block">{hint}</span>}
            </label>
          )
        })}
        {withDue && (
          <label className="text-xs text-foreground-muted space-y-1 block">
            Start at (optional)
            <input className={inputCls} type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
            <span className="block">Blank: as soon as the calling window allows.</span>
          </label>
        )}
      </div>
      <button type="button" className={btnPrimary} disabled={disabled || busy || !!missing.length} onClick={submit}>
        {busy ? 'Working…' : submitLabel}
      </button>
      {!!missing.length && <p className="text-xs text-foreground-muted">{`Fill in: ${missing.join(', ')}`}</p>}
    </div>
  )
}

function ResultLine({ r, onOpenJob }: { r: RowResult; onOpenJob: (id: string) => void }) {
  return (
    <div role="status" className="rounded-lg bg-surface-secondary p-3 text-sm space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {r.errors.length ? <Badge tone="red">Failed</Badge> : r.created ? <Badge tone="green">Created</Badge> : <Badge tone="amber">Duplicate</Badge>}
        {r.jobId && (
          <button type="button" className="text-xs text-accent-500 hover:underline" onClick={() => onOpenJob(r.jobId!)}>
            Open the job
          </button>
        )}
      </div>
      {r.errors.map((e, i) => (
        <p key={i} className="text-xs text-red-600 dark:text-red-400">{e}</p>
      ))}
      {!r.errors.length && !r.created && <p className="text-xs text-foreground-muted">A job with the same dedupe value already exists for this agent.</p>}
    </div>
  )
}

function ImportPanel({ agentId, inputs, disabled, onCreated }: { agentId: string; inputs: Record<string, InputSpec>; disabled: boolean; onCreated: () => void }) {
  const toast = useActionToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ created: number; duplicates: number; failed: { row: number; errors: string[] }[] } | null>(null)
  const entries = Object.entries(inputs)
  const isCsv = !!file && /\.(csv|txt)$/i.test(file.name)
  const missing = entries.filter(([k, s]) => s.required && !mapping[k]?.trim()).map(([k]) => k)

  async function pick(f: File | undefined) {
    setOut(null)
    setFile(f ?? null)
    setHeaders([])
    setMapping({})
    if (!f) return
    if (/\.(csv|txt)$/i.test(f.name)) {
      const hs = csvHeaders(await f.slice(0, 64 * 1024).text())
      setHeaders(hs)
      setMapping(Object.fromEntries(entries.flatMap(([k]) => { const m = hs.find(h => norm(h) === norm(k)); return m ? [[k, m]] : [] })))
    }
  }

  function sample() {
    const url = URL.createObjectURL(new Blob([`${entries.map(([k]) => k).join(',')}\n${entries.map(([, s]) => String(sampleOf(s))).join(',')}\n`], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'jobs-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function run() {
    if (!file) return
    setBusy(true)
    const fd = new FormData()
    fd.set('file', file)
    fd.set('mapping', JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]))))
    const { ok, data } = await api<{ created: number; duplicates: number; failed: { row: number; errors: string[] }[] }>(`${API}/agents/${agentId}/jobs/import`, { method: 'POST', body: fd })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'Could not import the file')
    setOut(data)
    if (data.created) onCreated()
    toast.success(`${data.created} created, ${data.duplicates} duplicates, ${data.failed.length} failed`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" aria-label="Jobs file" accept=".csv,.xlsx,.xls,text/csv" disabled={disabled} onChange={e => pick(e.target.files?.[0])} className="block text-sm text-foreground-muted file:mr-3 file:rounded-lg file:border file:border-border-default file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground" />
        <button type="button" className={btnGhost} onClick={sample}>
          Download CSV template
        </button>
      </div>
      {file && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Map columns to inputs</h3>
          {!isCsv && <p className="text-xs text-foreground-muted">Column names are not read from Excel files here. Type each column header exactly as in the first row of the sheet.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {entries.map(([k, s]) => (
              <label key={k} className="text-xs text-foreground-muted space-y-1 block">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono">{k}</span>
                  {s.required && <Badge tone="blue">Required</Badge>}
                </span>
                {isCsv && headers.length ? (
                  <select className={inputCls} value={mapping[k] ?? ''} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value }))}>
                    <option value="">{s.required ? 'Choose a column…' : 'Skip'}</option>
                    {headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                ) : (
                  <input className={inputCls} placeholder={s.required ? 'Column header' : 'Column header (optional)'} value={mapping[k] ?? ''} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value }))} />
                )}
              </label>
            ))}
          </div>
          <button type="button" className={btnPrimary} disabled={disabled || busy || !!missing.length} onClick={run}>
            {busy ? 'Importing…' : 'Import jobs'}
          </button>
          {!!missing.length && <p className="text-xs text-foreground-muted">{`Map: ${missing.join(', ')}`}</p>}
        </div>
      )}
      {out && (
        <div role="status" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="green">{`${out.created} created`}</Badge>
            <Badge tone="amber">{`${out.duplicates} duplicates`}</Badge>
            <Badge tone={out.failed.length ? 'red' : 'muted'}>{`${out.failed.length} failed`}</Badge>
          </div>
          {!!out.failed.length && (
            <div className="max-h-64 overflow-auto rounded-lg border border-border-default">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-foreground-muted border-b border-border-default">
                    <th className="px-3 py-1.5">Row</th>
                    <th className="px-3 py-1.5">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {out.failed.map(f => (
                    <tr key={f.row} className="border-t border-border-default/60 align-top">
                      <td className="px-3 py-1.5 tabular-nums">{f.row}</td>
                      <td className="px-3 py-1.5 text-red-600 dark:text-red-400">{f.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ApiPanel({ agentId, inputs }: { agentId: string; inputs: Record<string, InputSpec> }) {
  const toast = useActionToast()
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}${API}/agents/${agentId}/jobs`
  const body = useMemo(
    () => JSON.stringify({ rows: [{ inputs: Object.fromEntries(Object.entries(inputs).map(([k, s]) => [k, sampleOf(s)])), dueAt: '2026-12-01T10:00:00+05:30' }] }, null, 2),
    [inputs]
  )
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-foreground-muted">Send up to 200 jobs per request. Each row is checked against the inputs; the response lists one result per row (created, duplicate or errors). Requests need an admin session. dueAt is optional.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">POST</Badge>
        <code className="min-w-0 break-all text-xs">{url}</code>
        <button type="button" className={btnGhost} onClick={() => copy(url)}>Copy URL</button>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-foreground-muted">Sample body</span>
          <button type="button" className={btnGhost} onClick={() => copy(body)}>Copy</button>
        </div>
        <pre aria-label="Sample body" className="max-h-72 overflow-auto rounded-lg bg-surface-secondary p-3 text-xs font-mono whitespace-pre-wrap break-words">{body}</pre>
      </div>
      <pre aria-label="Sample response" className="rounded-lg bg-surface-secondary p-3 text-xs font-mono whitespace-pre-wrap">{`{ "results": [ { "ok": true, "created": true, "jobId": "…", "errors": [] } ] }`}</pre>
    </div>
  )
}

export default function AddJobs({ agentId, agentStatus, inputs, canWrite: canWriteProp, onCreated, onOpenJob }: {
  agentId: string
  agentStatus: string
  inputs: Record<string, InputSpec>
  canWrite: boolean
  onCreated: () => void
  onOpenJob: (id: string) => void
}) {
  const toast = useActionToast()
  const [mode, setMode] = useState<Mode>('form')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RowResult | null>(null)
  const hasInputs = Object.keys(inputs).length > 0
  const live = agentStatus === 'active'
  // A draft or paused agent only takes test jobs.
  // Gated here as well as by the parent: every job this panel creates is a write.
  const canWrite = useCanWrite('ecom_outreach:write') && canWriteProp
  const disabled = !canWrite || !live

  async function post(path: string, inputsBody: Record<string, unknown>, dueAt?: string) {
    setBusy(true)
    setResult(null)
    const test = path === 'jobs/test'
    const { ok, data } = await api<{ results?: RowResult[]; jobId?: string; created?: boolean; errors?: string[] }>(`${API}/agents/${agentId}/${path}`, {
      method: 'POST',
      json: test ? { inputs: inputsBody } : { inputs: inputsBody, ...(dueAt ? { dueAt } : {}) },
    })
    setBusy(false)
    if (test) {
      if (!ok) return setResult({ ok: false, created: false, errors: [data.error || 'Could not create the test job'] })
      setResult({ ok: true, created: !!data.created, jobId: data.jobId, errors: [] })
      onCreated()
      return toast.success('Test job created')
    }
    if (!ok) return setResult({ ok: false, created: false, errors: [data.error || 'Could not create the job'] })
    const r = data.results?.[0] ?? { ok: false, created: false, errors: ['No result'] }
    setResult(r)
    if (r.created) {
      onCreated()
      toast.success('Job created')
    }
  }

  return (
    <Card title="Add jobs" hint="Add one person with the form, import a file, call the API or send a test job to a test number.">
      <div className="space-y-4">
        {!hasInputs && <p className="text-sm text-amber-700 dark:text-amber-400">This agent declares no inputs yet. Add an inputs: block (with one role: contact phone) in the editor first.</p>}
        {!live && <p className="text-sm text-foreground-muted">{`This agent is ${agentStatus}. Activate it to add jobs; test jobs work meanwhile.`}</p>}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="How to add jobs">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => { setMode(m.id); setResult(null) }}
              className={`rounded-full border px-3 py-1 text-xs ${mode === m.id ? 'border-accent-500 text-foreground font-medium' : 'border-border-default text-foreground-muted hover:text-foreground'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {hasInputs && mode === 'form' && (
          <>
            <InputsForm key="form" inputs={inputs} submitLabel="Add job" busy={busy} disabled={disabled} withDue onSubmit={(i, d) => post('jobs', i, d)} />
            {result && <ResultLine r={result} onOpenJob={onOpenJob} />}
          </>
        )}
        {hasInputs && mode === 'import' && <ImportPanel agentId={agentId} inputs={inputs} disabled={disabled} onCreated={onCreated} />}
        {hasInputs && mode === 'api' && <ApiPanel agentId={agentId} inputs={inputs} />}
        {hasInputs && mode === 'test' && (
          <>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <Badge tone="amber">Test job</Badge>{' '}
              <span className="text-foreground">Goes only to one of the program&apos;s test numbers (Outreach program settings) and starts right away, even while the agent is a draft. It really calls or messages that number.</span>
            </div>
            <InputsForm key="test" inputs={inputs} submitLabel="Create test job" busy={busy} disabled={!canWrite} onSubmit={i => post('jobs/test', i)} />
            {result && <ResultLine r={result} onOpenJob={onOpenJob} />}
          </>
        )}
      </div>
    </Card>
  )
}
