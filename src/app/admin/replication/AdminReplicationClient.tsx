'use client'

import { useEffect, useState } from 'react'

type Run = {
  id: string
  run_id: string
  source: string
  status: 'ok' | 'failed' | 'partial' | 'started'
  started_at: string | null
  duration_seconds: number | null
  row_count: number | null
  dump_bytes: number | null
  message: string | null
  recorded_at: string
}

const STATUS_COLORS: Record<Run['status'], string> = {
  ok: 'bg-green-100 text-green-800 ring-green-600/20',
  failed: 'bg-red-100 text-red-800 ring-red-600/20',
  partial: 'bg-yellow-100 text-yellow-800 ring-yellow-600/20',
  started: 'bg-blue-100 text-blue-800 ring-blue-600/20',
}

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDuration(s: number | null): string {
  if (s === null || s === undefined) return '—'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

function fmtNumber(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminReplicationClient() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/replication/log?limit=50', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRuns(data.runs ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const lastOk = runs.find((r) => r.status === 'ok')
  const lastFail = runs.find((r) => r.status === 'failed')

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Replication Runs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Nightly RDS → Razer ML-replica history. Logged by{' '}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded">scripts/replicate_jeffi.sh</code> on
            the Razer at the end of each run.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Last successful run</div>
          <div className="text-base font-medium mt-1">
            {lastOk ? fmtTime(lastOk.recorded_at) : '—'}
          </div>
          {lastOk && (
            <div className="text-xs text-gray-500 mt-1">
              {fmtNumber(lastOk.row_count)} rows · {fmtBytes(lastOk.dump_bytes)} ·{' '}
              {fmtDuration(lastOk.duration_seconds)}
            </div>
          )}
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Last failure</div>
          <div className="text-base font-medium mt-1">
            {lastFail ? fmtTime(lastFail.recorded_at) : 'No failures recorded'}
          </div>
          {lastFail?.message && (
            <div className="text-xs text-red-600 mt-1 truncate" title={lastFail.message}>
              {lastFail.message}
            </div>
          )}
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Total runs (this view)</div>
          <div className="text-base font-medium mt-1">{runs.length}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
          Failed to load: {error}
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">Run ID</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Started</th>
              <th className="px-4 py-2">Duration</th>
              <th className="px-4 py-2 text-right">Rows</th>
              <th className="px-4 py-2 text-right">Dump</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {!loading && runs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No replication runs recorded yet. The nightly timer fires at 03:30 IST on the
                  Razer; the first POST will appear here within a few seconds of completion.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-mono text-xs">{r.run_id}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-700 ring-gray-400/20'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2">{fmtTime(r.started_at)}</td>
                <td className="px-4 py-2">{fmtDuration(r.duration_seconds)}</td>
                <td className="px-4 py-2 text-right">{fmtNumber(r.row_count)}</td>
                <td className="px-4 py-2 text-right">{fmtBytes(r.dump_bytes)}</td>
                <td className="px-4 py-2 text-gray-500">{r.source}</td>
                <td className="px-4 py-2 max-w-xs truncate text-gray-600" title={r.message ?? ''}>
                  {r.message ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
