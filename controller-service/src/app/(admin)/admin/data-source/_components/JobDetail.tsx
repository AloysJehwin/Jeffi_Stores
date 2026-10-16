'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Badge, Banner, type Tone } from '@/components/admin/channels/ui'
import { ACTIVE, Progress, downloadText, problemsCsv, rowRef, useJob, type ImportJob, type RowResult } from './shared'

const GROUPS: { outcome: RowResult['outcome']; label: string; tone: Tone }[] = [
  { outcome: 'error', label: 'Failed', tone: 'red' },
  { outcome: 'warning', label: 'Warnings', tone: 'amber' },
  { outcome: 'created', label: 'Created', tone: 'green' },
  { outcome: 'updated', label: 'Updated', tone: 'blue' },
  { outcome: 'deleted', label: 'Removed', tone: 'red' },
]

/** One import's live progress and its rows grouped by outcome, with a CSV of the problem rows. */
export default function JobDetail({ id, compact }: { id: string; compact?: boolean }) {
  const { job, error, loading } = useJob(id)
  if (loading) return <p className="text-sm text-foreground-muted py-2">Loading import details...</p>
  if (error || !job) return <p className="text-sm text-red-600 dark:text-red-400 py-2">{error || 'Import not found.'}</p>
  return <JobBody job={job} compact={compact} />
}

function JobBody({ job, compact }: { job: ImportJob; compact?: boolean }) {
  const rows = useMemo(() => job.row_results ?? [], [job.row_results])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.outcome] = (c[r.outcome] ?? 0) + 1
    return c
  }, [rows])
  const firstOpen = GROUPS.find(g => g.outcome === 'error' && counts.error)?.outcome ?? GROUPS.find(g => counts[g.outcome])?.outcome ?? null
  // Until the user picks a group, follow the results (a running job has none yet).
  const [picked, setOpen] = useState<RowResult['outcome'] | null | undefined>(undefined)
  const open = picked === undefined ? firstOpen : picked
  const [q, setQ] = useState('')
  const active = ACTIVE.has(job.status)
  const img = job.image_progress as { total?: number; fetched?: number; failed?: number }
  const problems = (counts.error ?? 0) + (counts.warning ?? 0)
  const shown = open
    ? rows
        .filter(r => r.outcome === open)
        .filter(r => !q || `${r.sku ?? ''} ${r.message ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : []

  return (
    <div className="space-y-3">
      {active && (
        <div className="space-y-1">
          <p className="text-xs text-foreground-muted">
            {job.status === 'pending' ? 'Queued. The import worker picks it up within a minute.' : 'Importing products...'}
          </p>
          <Progress done={job.processed_rows} total={job.total_rows} />
        </div>
      )}
      {job.last_error && <Banner ok={false}>{job.last_error}</Banner>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-green-700 dark:text-green-400">Created {job.created_count}</span>
        <span className="text-blue-700 dark:text-blue-400">Updated {job.updated_count}</span>
        <span className="text-red-600 dark:text-red-400">Failed {job.error_count}</span>
        {(img.total ?? 0) > 0 && (
          <span className="text-foreground-muted">
            Images {img.fetched ?? 0}/{img.total}
            {img.failed ? ` (${img.failed} failed)` : ''}
          </span>
        )}
        {problems > 0 && !active && (
          <button
            type="button"
            onClick={() => downloadText(`import-problems-${job.id.slice(0, 8)}.csv`, problemsCsv(rows))}
            className="ml-auto inline-flex items-center gap-1.5 text-xs text-accent-500 hover:underline"
          >
            <Download className="w-3.5 h-3.5" /> Download problem rows (CSV)
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        !active && !job.last_error && <p className="text-sm text-foreground-muted">No per-row results.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rows by outcome">
            {GROUPS.filter(g => counts[g.outcome]).map(g => (
              <button
                key={g.outcome}
                type="button"
                role="tab"
                aria-selected={open === g.outcome}
                onClick={() => setOpen(open === g.outcome ? null : g.outcome)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${open === g.outcome ? 'border-accent-500 bg-accent-500/10 text-foreground' : 'border-border-default text-foreground-muted hover:text-foreground'}`}
              >
                {g.label} <Badge tone={g.tone}>{counts[g.outcome]}</Badge>
              </button>
            ))}
          </div>
          {open && (
            <div className="space-y-2">
              {(counts[open] ?? 0) > 10 && (
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="Filter by SKU or message"
                  aria-label="Filter rows"
                  className="w-full sm:w-72 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-sm text-foreground"
                />
              )}
              <div className={`overflow-auto rounded-lg border border-border-default ${compact ? 'max-h-60' : 'max-h-80'}`}>
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-secondary text-left text-foreground-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium whitespace-nowrap">Where</th>
                      <th className="px-2 py-1.5 font-medium">SKU</th>
                      <th className="px-2 py-1.5 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i} className="border-t border-border-default/60 align-top">
                        <td className="px-2 py-1.5 whitespace-nowrap text-foreground-muted">{rowRef(r)}</td>
                        <td className="px-2 py-1.5 font-mono text-foreground">{r.sku ?? '-'}</td>
                        <td className="px-2 py-1.5 text-foreground-secondary break-words">{r.message ?? (r.outcome === 'created' ? 'New product' : 'Saved')}</td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-3 text-center text-foreground-muted">
                          No rows match.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
