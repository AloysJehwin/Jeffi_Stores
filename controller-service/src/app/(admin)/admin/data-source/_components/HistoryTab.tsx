'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Badge, Section, when } from '@/components/admin/kit/core'
import { InfiniteFooter, fetchJson, useInfiniteList } from '@/components/admin/kit/infinite'
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

/** Every import this store has run, loaded on scroll and filterable. */
export default function HistoryTab({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [open, setOpen] = useState<string | null>(null)

  const list = useInfiniteList<ImportJob>({
    key: `${status}|${source}|${refreshKey}`,
    pageSize: PAGE,
    getKey: j => j.id,
    fetchPage: async (p, signal) => {
      const data = await fetchJson<{ jobs: ImportJob[]; total: number }>(`/api/admin/data-source/jobs?status=${status}&source=${source}&limit=${PAGE}&offset=${(p - 1) * PAGE}`, signal)
      return { rows: data.jobs ?? [], total: data.total ?? 0 }
    },
  })
  const jobs = list.rows
  const total = list.total ?? 0
  const loading = list.loading
  const error = jobs.length ? null : list.error

  return (
    <Section title={`Imports (${total.toLocaleString('en-IN')})`}>
      <div className="flex flex-wrap gap-2 mb-3">
        <Filter options={STATUS} value={status} onChange={setStatus} label="Status" />
        <Filter options={SOURCE} value={source} onChange={setSource} label="Source" />
      </div>

      {error ? (
        <p className="text-sm text-red-500 py-6 text-center">{error}</p>
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
                <th className="px-2 py-2 font-medium text-right text-red-500">Skip</th>
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

      {!loading && !error && <InfiniteFooter shown={jobs.length} control={list} noun="imports" />}
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
