'use client'

import { useState, useEffect, useCallback } from 'react'

interface SyncStatus {
  status: 'success' | 'error' | 'running' | null
  synced?: number
  deleted?: number
  errors?: Array<{ sku: string; error: string }>
  started_at?: string
  finished_at?: string
}

export default function MerchantSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/merchant/status')
      if (!res.ok) return
      const data = await res.json()
      setStatus(data.status)
    } catch {}
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const triggerSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/merchant/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-requested-with': 'jeffi-admin' }, body: JSON.stringify({}) })
      const data = await res.json()
      setStatus({ status: data.errors?.length ? 'error' : 'success', synced: data.synced, deleted: data.deleted, errors: data.errors, started_at: data.startedAt, finished_at: data.finishedAt })
    } catch {
      setStatus({ status: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  const bgClass = status?.status === 'error'
    ? 'bg-red-50 border-red-200'
    : status?.status === 'success'
    ? 'bg-green-50 border-green-200'
    : 'bg-surface-elevated border-border-default'

  const textClass = status?.status === 'error' ? 'text-red-700' : status?.status === 'success' ? 'text-green-700' : 'text-foreground-secondary'

  return (
    <div className={`rounded-lg border p-4 mb-6 ${bgClass}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <svg className="w-5 h-5 flex-shrink-0 text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 11H4L5 9z" />
          </svg>
          <div className="min-w-0">
            <p className={`text-sm font-medium ${textClass}`}>
              Google Merchant Center
              {status?.status === 'success' && ` — ${status.synced ?? 0} items synced`}
              {status?.status === 'error' && ` — ${status.errors?.length ?? 0} error(s)`}
              {!status && ' — no sync yet'}
            </p>
            {status?.finished_at && (
              <p className="text-xs text-foreground-muted mt-0.5">
                Last sync: {new Date(status.finished_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {status?.errors && status.errors.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-red-600 underline hover:no-underline"
            >
              {expanded ? 'Hide' : 'Show'} errors
            </button>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="px-3 py-1.5 text-sm bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {expanded && status?.errors && status.errors.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded border border-red-200 bg-white p-2 space-y-1">
          {status.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-700">
              <span className="font-mono font-medium">{e.sku}</span>: {e.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
