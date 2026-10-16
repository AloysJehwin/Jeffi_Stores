'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, btnGhost, btnPrimary } from './ui'

// Every console change: preview first (validation problems and before/after), then Apply.

interface Outcome {
  ok: boolean
  preview: boolean
  summary: string
  before?: unknown
  after?: unknown
  problems: string[]
  error?: string
}

function Value({ v }: { v: unknown }) {
  if (v == null) return <span className="text-foreground-muted">-</span>
  if (typeof v !== 'object') return <span>{String(v)}</span>
  return <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-auto bg-surface rounded p-2 border border-border-default">{JSON.stringify(v, null, 2)}</pre>
}

export default function PreviewApply({
  endpoint,
  payload,
  onClose,
  onDone,
  applyLabel = 'Apply',
  writeScope,
}: {
  writeScope: string
  endpoint: string
  payload: Record<string, unknown>
  onClose: () => void
  onDone?: (summary: string) => void
  applyLabel?: string
}) {
  const [preview, setPreview] = useState<Outcome | null>(null)
  const [result, setResult] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState(true)
  const canWrite = useCanWrite(writeScope)

  useEffect(() => {
    let live = true
    api<Outcome>(endpoint, { method: 'POST', json: { ...payload, preview: true } }).then(r => {
      if (!live) return
      setPreview(r.ok ? r.data : { ok: false, preview: true, summary: '', problems: [r.data.error || 'Preview failed'] })
      setBusy(false)
    })
    return () => {
      live = false
    }
  }, [endpoint, payload])

  async function apply() {
    setBusy(true)
    const r = await api<Outcome>(endpoint, { method: 'POST', json: { ...payload, preview: false } })
    setBusy(false)
    const out = r.data.summary ? r.data : { ok: false, preview: false, summary: '', problems: [r.data.error || 'Request failed'] }
    setResult(out)
    if (out.ok) onDone?.(out.summary)
  }

  const shown = result ?? preview
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-surface-elevated border border-border-default rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-foreground">{shown?.summary || 'Checking the change...'}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="text-foreground-muted hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {shown?.problems?.length ? (
          <ul className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm list-disc pl-6 space-y-1">
            {shown.problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {result?.ok && <p className="rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3 text-sm">Done. The change is in the change history.</p>}
        {shown && (shown.before !== undefined || shown.after !== undefined) && (
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div>
              <p className="text-xs text-foreground-muted uppercase mb-1">Before</p>
              <Value v={shown.before} />
            </div>
            <div>
              <p className="text-xs text-foreground-muted uppercase mb-1">After</p>
              <Value v={shown.after} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          {!result?.ok && (
            <button type="button" className={btnPrimary} disabled={busy || !preview?.ok || !canWrite} onClick={apply}>
              {busy ? 'Working...' : applyLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
