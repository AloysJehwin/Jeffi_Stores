'use client'

import { useState, useEffect, useCallback } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { groupSyncErrors, countSyncErrorItems, type MerchantSyncError } from '@/lib/merchant/sync-errors'
import { DataTable, Kpi, StatusBadge, btnGhost, btnPrimary, count, fieldInputCls, type DataCol, type StatusMap } from '@/components/admin/kit'

interface Summary {
  last_refreshed_at: string | null
  total: number
  approved: number
  pending: number
  disapproved: number
}
interface Row {
  offer_id: string
  title: string | null
  status: string | null
  link: string | null
  price: string | null
  item_issues: Array<{ code?: string; description?: string; servability?: string }>
}
interface SyncStatus {
  status: 'success' | 'error' | 'running' | null
  synced?: number
  errors?: MerchantSyncError[] | null
  finished_at?: string
}

const STATUS_POLL_MS = 5000

function SyncErrors({ errors }: { errors: MerchantSyncError[] }) {
  const groups = groupSyncErrors(errors)
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

const PAGE_SIZE = 50

const ITEM_STATUS: StatusMap = {
  approved: { label: 'approved', tone: 'green' },
  disapproved: { label: 'disapproved', tone: 'red' },
  pending: { label: 'pending', tone: 'amber' },
}

const ITEM_COLS: DataCol<Row>[] = [
  { key: 'offer', label: 'Offer ID', render: r => <span className="font-mono text-xs">{r.offer_id}</span> },
  { key: 'title', label: 'Title', render: r => <span className="block max-w-md truncate">{r.title || '-'}</span> },
  { key: 'status', label: 'Status', render: r => <StatusBadge status={(r.status || 'unknown').toLowerCase()} map={ITEM_STATUS} /> },
  {
    key: 'issue',
    label: 'Top issue',
    render: r => <span className="block max-w-xs truncate text-xs text-foreground-secondary">{r.item_issues?.[0]?.description || (r.status === 'approved' ? '-' : '')}</span>,
  },
]

export default function GoogleMerchantPanel() {
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
  const [syncRunning, setSyncRunning] = useState(false)
  const { showToast } = useToast()

  const load = useCallback(
    async (opts?: { page?: number; search?: string; status?: string }) => {
      setLoading(true)
      try {
        const p = opts?.page ?? page
        const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) })
        const s = opts?.search ?? search
        const st = opts?.status ?? statusFilter
        if (s) params.set('search', s)
        if (st && st !== 'all') params.set('status', st)
        const res = await fetch(`/api/admin/merchant/gmc-status?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to load')
        const data = await res.json()
        setSummary(data.summary)
        setRows(data.rows)
        setTotal(data.total)
      } catch {
        showToast('Failed to load Google Merchant data.', 'error')
      } finally {
        setLoading(false)
      }
    },
    [page, search, statusFilter, showToast]
  )

  useEffect(() => {
    load({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // DB->GMC sync status banner; `running` reflects the server-side sync lock (any tab or the cron).
  const loadSyncStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/merchant/status')
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
      const res = await fetch('/api/admin/merchant/gmc-status/refresh', {
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
      await load({ page: 1 })
      setPage(1)
      showToast('Refreshed from Google Merchant Center.', 'success')
    } catch {
      showToast('Refresh failed.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/merchant/sync', {
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
        showToast(`Pushed ${data.synced ?? 0} items to Google.`, 'success')
      }
    } catch {
      showToast('Sync failed.', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const go = (p: number) => {
    setPage(p)
    load({ page: p })
  }
  const doSearch = () => {
    setPage(1)
    load({ page: 1 })
  }
  const changeStatus = (st: string) => {
    setStatusFilter(st)
    setPage(1)
    load({ page: 1, status: st })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
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
        <div className="flex items-center gap-2">
          <RequireWrite scope="merchant_sync:write">
            <button
              onClick={syncNow}
              disabled={syncing || syncRunning}
              className={btnGhost}
            >
              {syncing || syncRunning ? 'Syncing…' : 'Sync now (push to Google)'}
            </button>
            <button
              onClick={refresh}
              disabled={refreshing}
              className={btnPrimary}
            >
              {refreshing ? 'Refreshing…' : 'Refresh from Google'}
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
          <Kpi label="Total in feed" value={count(summary?.total ?? 0)} />
          <Kpi label="Approved" value={count(summary?.approved ?? 0)} />
          <Kpi label="Pending" value={count(summary?.pending ?? 0)} />
          <Kpi label="Disapproved" value={count(summary?.disapproved ?? 0)} />
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
          <div className="flex items-center gap-1">
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
          rows={rows}
          cols={ITEM_COLS}
          rowKey={r => r.offer_id}
          pageSize={PAGE_SIZE}
          loading={loading}
          empty={summary?.last_refreshed_at ? 'No items match.' : 'No data yet. Click "Refresh from Google".'}
          mobileCard={r => (
            <div className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-foreground truncate">{r.offer_id}</span>
                <StatusBadge status={(r.status || 'unknown').toLowerCase()} map={ITEM_STATUS} />
              </div>
              <p className="text-sm text-foreground truncate">{r.title || '-'}</p>
              {r.item_issues?.[0]?.description && <p className="text-xs text-foreground-muted">{r.item_issues[0].description}</p>}
            </div>
          )}
        />

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => go(page - 1)} disabled={page <= 1} className={btn}>
                Prev
              </button>
              <span className="text-xs text-foreground-muted">
                {page}/{totalPages}
              </span>
              <button onClick={() => go(page + 1)} disabled={page >= totalPages} className={btn}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
