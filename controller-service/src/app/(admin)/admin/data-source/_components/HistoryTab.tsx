'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Badge, Section, when } from '@/components/admin/channels/ui'
import { useOverviewData } from '@/components/admin/overview/kit'
import JobDetail from './JobDetail'
import { JobBadge, duration, sheetUrl, sourceLabel, type ImportJob } from './shared'

type StatusFilter = 'all' | 'active' | 'done' | 'with_errors' | 'failed'
type SourceFilter = 'all' | 'upload' | 'google_sheet'

const STATUS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Running' },
  { id: 'with_errors', label: 'With errors' },
  { id: 'done', label: 'Clean' },
  { id: 'failed', label: 'Failed' },
]

const SOURCE: { id: SourceFilter; label: string }[] = [
  { id: 'all', label: 'All sources' },
  { id: 'upload', label: 'File uploads' },
  { id: 'google_sheet', label: 'Google Sheet syncs' },
]

const PAGE = 20

/** Every import this store has run, paged and filterable. */
export default function HistoryTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  const url = `/api/admin/data-source/jobs?status=${status}&source=${source}&limit=${PAGE}&offset=${(page - 1) * PAGE}&k=${refreshKey}`
  const { data, loading, error } = useOverviewData<{ jobs: ImportJob[]; total: number }>(url)
  const jobs = data?.jobs ?? []
  const total = data?.total ?? 0
  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE)), [total])

  return (
    <Section title={`Imports (${total.toLocaleString('en-IN')})`}>
      <div className="flex flex-wrap gap-2 mb-3">
        <Filter options={STATUS} value={status} onChange={v => (setPage(1), setStatus(v))} label="Status" />
        <Filter options={SOURCE} value={source} onChange={v => (setPage(1), setSource(v))} label="Source" />
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400 py-6 text-center">{error}</p>
      ) : loading ? (
        <p className="text-sm text-foreground-muted py-6 text-center">Loading...</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-foreground-muted py-6 text-center">No imports match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-foreground-muted">
              <tr className="border-b border-border-default">
                <th className="px-2 py-2 font-medium w-8" />
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Source</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium text-right">Rows</th>
                <th className="px-2 py-2 font-medium text-right text-green-700 dark:text-green-400">New</th>
                <th className="px-2 py-2 font-medium text-right text-blue-700 dark:text-blue-400">Upd</th>
                <th className="px-2 py-2 font-medium text-right text-red-600 dark:text-red-400">Skip</th>
                <th className="px-2 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                const expanded = open === j.id
                const d = duration(j.created_at, j.finished_at)
                return (
                  <Fragment key={j.id}>
                    <tr className="border-b border-border-default/60 hover:bg-surface-secondary/40 cursor-pointer" onClick={() => setOpen(expanded ? null : j.id)}>
                      <td className="px-2 py-2 text-foreground-muted">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Hide rows' : 'Show rows'}
                          onClick={e => (e.stopPropagation(), setOpen(expanded ? null : j.id))}
                          className="inline-flex"
                        >
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-foreground-muted">{when(j.created_at)}</td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1">
                          {sourceLabel(j.source)}
                          {j.source === 'google_sheet' && j.spreadsheet_id && (
                            <a
                              href={sheetUrl(j.spreadsheet_id)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-accent-500 hover:underline"
                              aria-label="Open sheet"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <JobBadge status={j.status} errors={j.error_count} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {j.processed_rows}/{j.total_rows}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{j.created_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{j.updated_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {j.error_count > 0 ? <Badge tone="red">{j.error_count}</Badge> : <span className="text-foreground-muted">0</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-foreground-muted">{d ?? (j.status === 'running' ? 'running' : '-')}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-surface-secondary/40 border-b border-border-default/60">
                        <td colSpan={9} className="px-3 py-3">
                          <JobDetail id={j.id} compact />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-3 text-xs text-foreground-muted">
          <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Prev
          </button>
          {page} / {pages}
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </Section>
  )
}

function Filter<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-foreground-muted">{label}</span>
      <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md ${value === o.id ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
