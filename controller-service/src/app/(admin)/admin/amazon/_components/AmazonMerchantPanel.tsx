'use client'

import { useState, useEffect, useCallback } from 'react'
import CopySku from '@/components/ui/CopySku'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { countSyncErrorItems, type MerchantSyncError } from '@/lib/merchant/sync-errors'
import { groupAmazonSyncErrors } from '@/lib/amazon/sync-errors'
import { DataTable, fetchJson, useInfiniteList, Kpi, StatusBadge, btnGhost, btnPrimary, count, fieldInputCls, type DataCol, type StatusMap } from '@/components/admin/kit'

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
  errors?: MerchantSyncError[] | null
  finished_at?: string
}

const PAGE_SIZE = 50
const STATUS_POLL_MS = 5000

function SyncErrors({ errors }: { errors: MerchantSyncError[] }) {
  const groups = groupAmazonSyncErrors(errors)
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-red-600 dark:text-red-400">
        Last push had {countSyncErrorItems(errors).toLocaleString()} error(s) across {groups.length} reason(s).
      </p>
      <ul className="space-y-1.5">
        {groups.map(g => (
          <li key={g.reason} className="text-xs text-red-600 dark:text-red-400">
            <details>
              <summary className="cursor-pointer">
                <span className="font-semibold">{g.count.toLocaleString()}</span> {g.reason}
              </summary>
              <p className="mt-1 font-mono text-[11px] text-foreground-secondary break-words">
                {g.skus.join(', ')}
                {g.skus.length < g.count ? ' …' : ''}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}

const LISTING_STATUS: StatusMap = {
  approved: { label: 'approved', tone: 'green' },
  disapproved: { label: 'disapproved', tone: 'red' },
  pending: { label: 'pending', tone: 'amber' },
}

const LISTING_COLS: DataCol<Row>[] = [
  {
    key: 'sku',
    label: 'SKU',
    render: r => (
      <span className="inline-flex items-center gap-1 font-mono text-xs">
        {r.sku}
        {r.sku && <CopySku sku={r.sku} />}
      </span>
    ),
  },
  { key: 'title', label: 'Title', render: r => <span className="block max-w-md truncate">{r.title || '-'}</span> },
  { key: 'status', label: 'Status', render: r => <StatusBadge status={(r.status || 'unknown').toLowerCase()} map={LISTING_STATUS} /> },
  { key: 'issue', label: 'Top issue', render: r => <span className="block max-w-xs truncate text-xs text-foreground-secondary">{r.issues?.[0]?.message || (r.status === 'approved' ? '-' : '')}</span> },
]

export default function AmazonMerchantPanel() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const { showToast } = useToast()

  const list = useInfiniteList<Row>({
    key: `${applied}|${statusFilter}`,
    pageSize: PAGE_SIZE,
    getKey: r => r.sku,
    fetchPage: async (p, signal) => {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) })
      if (applied) params.set('search', applied)
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      const data = await fetchJson(`/api/admin/merchant/amazon/listing-status?${params.toString()}`, signal)
      if (p === 1) setSummary(data.summary)
      return { rows: data.rows, total: data.total }
    },
  })

  // DB->Amazon push status; `running` reflects the server-side sync lock (any tab or the cron).
  const loadSyncStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/merchant/amazon/status')
      if (!r.ok) return
      const d = await r.json()
      setSyncStatus(d.status)
      setSyncRunning(!!d.running)
    } catch {}
  }, [])

  useEffect(() => {
    loadSyncStatus()
  }, [loadSyncStatus])

  useEffect(() => {
    if (!syncRunning || syncing) return
    const t = setInterval(loadSyncStatus, STATUS_POLL_MS)
    return () => clearInterval(t)
  }, [syncRunning, syncing, loadSyncStatus])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/merchant/amazon/listing-status/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'jeffi-admin' },
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Refresh failed', 'error')
        return
      }
      setSummary(data.summary)
      list.reload()
      showToast('Refreshed from Amazon.', 'success')
    } catch {
      showToast('Refresh failed.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/merchant/amazon/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'jeffi-admin' },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setSyncRunning(true)
        showToast(data.error || 'A sync is already running.', 'warning')
        return
      }
      if (!res.ok) {
        showToast(data.error || 'Sync failed.', 'error')
        return
      }
      setSyncStatus({
        status: data.errors?.length ? 'error' : 'success',
        synced: data.synced,
        errors: data.errors,
        finished_at: data.finishedAt,
      })
      setSyncRunning(false)
      if (data.errors?.length) {
        showToast(`Sync finished with ${countSyncErrorItems(data.errors).toLocaleString()} error(s).`, 'warning')
      } else {
        showToast(`Pushed ${data.synced ?? 0} items to Amazon.`, 'success')
      }
    } catch {
      showToast('Sync failed.', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const doSearch = () => setApplied(search.trim())
  const changeStatus = (st: string) => setStatusFilter(st)
  const btn =
    'control-sm border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors'

  return (
    <section className="rounded-xl border border-border-default bg-surface-elevated">
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
        <div className="flex flex-wrap items-center gap-2">
          <RequireWrite scope="merchant_sync:write">
            <button
              onClick={syncNow}
              disabled={syncing || syncRunning}
              className={btnGhost}
            >
              {syncing || syncRunning ? 'Pushing…' : 'Sync now (push to Amazon)'}
            </button>
            <button
              onClick={refresh}
              disabled={refreshing}
              className={btnPrimary}
            >
              {refreshing ? 'Refreshing…' : 'Refresh from Amazon'}
            </button>
          </RequireWrite>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {syncRunning && !syncing ? (
          <p className="text-xs text-foreground-muted">A sync is running. This updates when it finishes.</p>
        ) : null}
        {syncStatus?.status === 'error' && syncStatus.errors?.length ? <SyncErrors errors={syncStatus.errors} /> : null}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Total listings" value={count(summary?.total ?? 0)} />
          <Kpi label="Approved" value={count(summary?.approved ?? 0)} />
          <Kpi label="Pending" value={count(summary?.pending ?? 0)} />
          <Kpi label="Blocked" value={count(summary?.disapproved ?? 0)} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') doSearch()
              }}
              placeholder="Search SKU or title…"
              className={`${fieldInputCls} w-64 max-w-full`}
            />
            <button onClick={doSearch} className={btn}>
              Search
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {['all', 'approved', 'pending', 'disapproved'].map(st => (
              <button
                key={st}
                onClick={() => changeStatus(st)}
                className={`control-sm text-xs border transition-colors ${statusFilter === st ? 'bg-accent-500 text-white border-accent-500' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          rows={list.rows}
          infinite={list}
          cols={LISTING_COLS}
          rowKey={r => r.sku}
          empty={summary?.last_refreshed_at ? 'No items match.' : 'No data yet. Click "Refresh from Amazon".'}
          mobileCard={r => (
            <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 font-mono text-xs text-foreground truncate">
                  {r.sku}
                  {r.sku && <CopySku sku={r.sku} />}
                </span>
                <StatusBadge status={(r.status || 'unknown').toLowerCase()} map={LISTING_STATUS} />
              </div>
              <p className="text-sm text-foreground truncate">{r.title || '-'}</p>
              {r.issues?.[0]?.message && <p className="text-xs text-foreground-muted">{r.issues[0].message}</p>}
            </div>
          )}
        />

      </div>
    </section>
  )
}
