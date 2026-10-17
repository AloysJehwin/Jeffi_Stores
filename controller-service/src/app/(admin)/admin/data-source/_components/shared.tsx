'use client'

import { useEffect, useState } from 'react'
import { api, Badge, type Tone } from '@/components/admin/kit/core'

export interface RowResult {
  row: number
  sheet?: string
  sku: string | null
  outcome: 'created' | 'updated' | 'error' | 'warning' | 'deleted'
  message?: string
}
export interface PendingDeletion {
  productId: string
  sku: string
  name: string
}
export interface ImageProgress {
  total: number
  fetched: number
  failed: number
}
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'
export interface ImportJob {
  id: string
  source: 'upload' | 'google_sheet'
  status: JobStatus
  total_rows: number
  processed_rows: number
  created_count: number
  updated_count: number
  error_count: number
  row_results: RowResult[]
  image_progress: ImageProgress | Record<string, never>
  spreadsheet_id?: string | null
  pending_deletions?: PendingDeletion[]
  last_error: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}
export interface GsheetLastSync {
  id: string
  status: JobStatus
  totalRows: number
  processedRows: number
  createdCount: number
  updatedCount: number
  errorCount: number
  imageProgress: ImageProgress | Record<string, never>
  pendingDeletions: PendingDeletion[]
  lastError: string | null
  createdAt: string
  finishedAt: string | null
}
export interface GsheetStatus {
  enabled: boolean
  connected: boolean
  state?: 'connected' | 'needs_reconnect' | 'not_connected'
  spreadsheetId: string | null
  account?: string | null
  connectedAt?: string | null
  canCreate?: boolean
  lastSync: GsheetLastSync | null
}

export const EMPTY_GSHEET: GsheetStatus = { enabled: true, connected: false, state: 'not_connected', spreadsheetId: null, lastSync: null }

export const ACTIVE = new Set<JobStatus>(['pending', 'running'])

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`

export const sourceLabel = (s: ImportJob['source']) => (s === 'google_sheet' ? 'Google Sheet' : 'File upload')

export function jobState(status: JobStatus, errors: number): { label: string; tone: Tone } {
  if (status === 'pending') return { label: 'Queued', tone: 'muted' }
  if (status === 'running') return { label: 'Running', tone: 'blue' }
  if (status === 'failed') return { label: 'Failed', tone: 'red' }
  return errors > 0 ? { label: 'Done with errors', tone: 'amber' } : { label: 'Done', tone: 'green' }
}

export function JobBadge({ status, errors }: { status: JobStatus; errors: number }) {
  const s = jobState(status, errors)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Elapsed time of a finished job; null while it runs (keeps server and client renders equal). */
export function duration(start: string, end: string | null): string | null {
  if (!end) return null
  const sec = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ${sec % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const rowRef = (r: Pick<RowResult, 'row' | 'sheet'>) => (r.row ? `${r.sheet ? `${r.sheet} ` : ''}row ${r.row}` : '-')

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className="flex items-center gap-2 min-w-[8rem]">
      <div className="h-1.5 flex-1 rounded-full bg-surface-secondary overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-foreground-muted">
        {done}/{total}
      </span>
    </div>
  )
}

/** Problem rows (errors and warnings) as CSV, to fix in the sheet and upload again. */
export function problemsCsv(rows: RowResult[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['sheet', 'row', 'sku', 'outcome', 'message']]
  for (const r of rows) if (r.outcome === 'error' || r.outcome === 'warning') lines.push([r.sheet ?? '', String(r.row || ''), r.sku ?? '', r.outcome, r.message ?? ''])
  return lines.map(l => l.map(esc).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One job, re-fetched every 3s while it is queued or running; polling stops when it finishes. */
export function useJob(id: string | null, nonce = 0): { job: ImportJob | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ id: string; job?: ImportJob; error?: string } | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const r = await api<{ job: ImportJob }>(`/api/admin/data-source/jobs/${id}`)
        if (!live) return
        if (r.ok && r.data.job) {
          setState({ id, job: r.data.job })
          if (ACTIVE.has(r.data.job.status)) timer = setTimeout(tick, 3000)
        } else {
          setState({ id, error: r.data.error || 'Could not load this import.' })
        }
      } catch {
        if (live) timer = setTimeout(tick, 6000)
      }
    }
    tick()
    return () => {
      live = false
      if (timer) clearTimeout(timer)
    }
  }, [id, nonce])
  const mine = state && state.id === id ? state : null
  return { job: mine?.job ?? null, error: mine?.error ?? null, loading: !!id && !mine }
}

export const iconBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-default px-2 sm:px-3 py-1.5 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50 whitespace-nowrap'
