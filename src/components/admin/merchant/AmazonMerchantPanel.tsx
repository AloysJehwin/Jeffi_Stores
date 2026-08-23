'use client'

import { useState, useEffect, useCallback } from 'react'
import CopySku from '@/components/ui/CopySku'

interface Summary {
  last_refreshed_at: string | null
  total: number
  approved: number
  pending: number
  disapproved: number
}
interface Row {
  sku: string
  title: string | null
  status: string | null
  asin: string | null
  price: string | null
  issues: Array<{ code?: string; severity?: string; message?: string }>
}
interface SyncStatus {
  status: 'success' | 'error' | 'running' | null
  synced?: number
  errors?: Array<{ sku: string; error: string }>
  finished_at?: string
}

const PAGE_SIZE = 50

function StatusBadge({ status }: { status: string | null }) {
  const s = (status || 'unknown').toLowerCase()
  const cls =
    s === 'approved' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    : s === 'disapproved' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    : s === 'pending' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  return <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${cls}`}>{s}</span>
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <p className={`text-2xl font-bold ${tone || 'text-foreground'}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-foreground-muted mt-0.5">{label}</p>
    </div>
  )
}

export default function AmazonMerchantPanel() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async (opts?: { page?: number; search?: string; status?: string }) => {
    setLoading(true)
    try {
      const p = opts?.page ?? page
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) })
      const s = opts?.search ?? search
      const st = opts?.status ?? statusFilter
      if (s) params.set('search', s)
      if (st && st !== 'all') params.set('status', st)
      const res = await fetch(`/api/admin/merchant/amazon/listing-status?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setSummary(data.summary)
      setRows(data.rows)
      setTotal(data.total)
    } catch {
      setMsg('Failed to load Amazon listing data.')
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter])

  useEffect(() => {
    load({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the DB->Amazon push status banner.
  useEffect(() => {
    fetch('/api/admin/merchant/amazon/status').then(r => r.ok ? r.json() : null).then(d => d && setSyncStatus(d.status)).catch(() => {})
  }, [])

  const refresh = async () => {
    setRefreshing(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/merchant/amazon/listing-status/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'jeffi-admin' }, body: '{}',
      })
      const data = await res.json()
      if (!res.ok) { setMsg(data.error || 'Refresh failed'); return }
      setSummary(data.summary)
      await load({ page: 1 }); setPage(1)
      setMsg('Refreshed from Amazon.')
    } catch {
      setMsg('Refresh failed.')
    } finally {
      setRefreshing(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/merchant/amazon/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'jeffi-admin' }, body: '{}',
      })
      const data = await res.json()
      setSyncStatus({ status: data.errors?.length ? 'error' : 'success', synced: data.synced, errors: data.errors, finished_at: data.finishedAt })
      setMsg(data.errors?.length ? `Sync finished with ${data.errors.length} error(s).` : `Pushed ${data.synced ?? 0} items to Amazon.`)
    } catch {
      setMsg('Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  const go = (p: number) => { setPage(p); load({ page: p }) }
  const doSearch = () => { setPage(1); load({ page: 1 }) }
  const changeStatus = (st: string) => { setStatusFilter(st); setPage(1); load({ page: 1, status: st }) }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const btn = 'px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  return (
    <section className="rounded-lg border border-border-default bg-surface-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          {summary?.last_refreshed_at ? (
            <span className="text-xs text-foreground-muted">
              Synced {new Date(summary.last_refreshed_at).toLocaleString()}
            </span>
          ) : (
            <span className="text-xs text-foreground-muted">Not refreshed yet</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncNow} disabled={syncing} className="px-3 py-1.5 text-sm border border-border-default rounded-lg text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50 transition-colors">
            {syncing ? 'Pushing…' : 'Sync now (push to Amazon)'}
          </button>
          <button onClick={refresh} disabled={refreshing} className="px-3 py-1.5 text-sm bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 transition-colors">
            {refreshing ? 'Refreshing…' : 'Refresh from Amazon'}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {msg && <p className="text-sm text-foreground-secondary">{msg}</p>}
        {syncStatus?.status === 'error' && syncStatus.errors?.length ? (
          <p className="text-xs text-red-600">Last push had {syncStatus.errors.length} error(s).</p>
        ) : null}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total listings" value={summary?.total ?? 0} />
          <StatCard label="Approved" value={summary?.approved ?? 0} tone="text-green-600" />
          <StatCard label="Pending" value={summary?.pending ?? 0} tone="text-amber-600" />
          <StatCard label="Blocked" value={summary?.disapproved ?? 0} tone="text-red-600" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
              placeholder="Search SKU or title…"
              className="px-3 py-1.5 text-sm border border-border-default rounded-lg bg-surface text-foreground w-64 max-w-full"
            />
            <button onClick={doSearch} className={btn}>Search</button>
          </div>
          <div className="flex items-center gap-1">
            {['all', 'approved', 'pending', 'disapproved'].map(st => (
              <button key={st} onClick={() => changeStatus(st)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${statusFilter === st ? 'bg-accent-500 text-white border-accent-500' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}>
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-foreground-muted">
              <tr>
                <th className="text-left font-medium px-3 py-2">SKU</th>
                <th className="text-left font-medium px-3 py-2">Title</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Top issue</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-foreground-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-foreground-muted">
                  {summary?.last_refreshed_at ? 'No items match.' : 'No data yet — click “Refresh from Amazon”.'}
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.sku} className="border-t border-border-default">
                  <td className="px-3 py-2 font-mono text-xs text-foreground"><span className="inline-flex items-center gap-1">{r.sku}{r.sku && <CopySku sku={r.sku} />}</span></td>
                  <td className="px-3 py-2 text-foreground max-w-md truncate">{r.title || '—'}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-xs text-foreground-secondary max-w-xs truncate">
                    {r.issues?.[0]?.message || (r.status === 'approved' ? '—' : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => go(page - 1)} disabled={page <= 1} className={btn}>Prev</button>
              <span className="text-xs text-foreground-muted">{page}/{totalPages}</span>
              <button onClick={() => go(page + 1)} disabled={page >= totalPages} className={btn}>Next</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
