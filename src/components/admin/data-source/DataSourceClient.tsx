'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import GoogleSheetDisconnect from './GoogleSheetDisconnect'

interface RowResult {
  row: number
  sku: string | null
  outcome: 'created' | 'updated' | 'error' | 'warning' | 'deleted'
  message?: string
}
interface PendingDeletion { productId: string; sku: string; name: string }
interface ImageProgress { total: number; fetched: number; failed: number }
interface ImportJob {
  id: string
  source: string
  status: 'pending' | 'running' | 'done' | 'failed'
  total_rows: number
  processed_rows: number
  created_count: number
  updated_count: number
  error_count: number
  row_results: RowResult[]
  image_progress: ImageProgress
  last_error: string | null
  created_at: string
  finished_at: string | null
}

interface GsheetLastSync {
  id: string
  status: ImportJob['status']
  totalRows: number
  processedRows: number
  createdCount: number
  updatedCount: number
  errorCount: number
  imageProgress: ImageProgress
  pendingDeletions: PendingDeletion[]
  lastError: string | null
  createdAt: string
  finishedAt: string | null
}
interface GsheetStatus {
  enabled: boolean
  connected: boolean
  spreadsheetId: string | null
  lastSync: GsheetLastSync | null
}

const ACTIVE = new Set(['pending', 'running'])

type Tab = 'import' | 'google_sheet' | 'history'

const TAB_KEYS: Tab[] = ['import', 'google_sheet', 'history']

export default function DataSourceClient({ initialGsheet }: { initialGsheet?: GsheetStatus }) {
  const canWrite = useCanWrite('products')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<ImportJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [gsheet, setGsheet] = useState<GsheetStatus>(
    initialGsheet ?? { enabled: false, connected: false, spreadsheetId: null, lastSync: null },
  )
  const [sheetInput, setSheetInput] = useState(initialGsheet?.spreadsheetId ?? '')
  const [syncing, setSyncing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const requestedTab = searchParams.get('tab') as Tab | null
  const tab: Tab = requestedTab && TAB_KEYS.includes(requestedTab) && (requestedTab !== 'google_sheet' || gsheet.enabled)
    ? requestedTab
    : 'import'

  function selectTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // The Google connect flow returns here with ?connected=…; show the outcome once, then drop it.
  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected === null) return
    const error = searchParams.get('error')
    setNotice(connected === '0'
      ? { kind: 'err', text: `Google connection failed${error ? `: ${error}` : '.'}` }
      : { kind: 'ok', text: 'Google account connected.' })
    const params = new URLSearchParams(searchParams.toString())
    params.delete('connected')
    params.delete('error')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, pathname, router])
  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/admin/data-source/jobs', { credentials: 'include' })
    if (res.ok) setJobs((await res.json()).jobs ?? [])
  }, [])

  const loadGsheet = useCallback(async () => {
    const res = await fetch('/api/admin/data-source/google/status', { credentials: 'include' })
    if (res.ok) {
      const s: GsheetStatus = await res.json()
      setGsheet(s)
      if (s.spreadsheetId) setSheetInput(prev => prev || s.spreadsheetId!)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { loadGsheet() }, [loadGsheet])

  // Poll while any job is active so live progress (rows + images) updates without a refresh.
  useEffect(() => {
    if (!jobs.some(j => ACTIVE.has(j.status))) return
    const t = setInterval(() => { loadJobs(); loadGsheet() }, 4000)
    return () => clearInterval(t)
  }, [jobs, loadJobs, loadGsheet])

  const downloadTemplate = () => { window.location.href = '/api/admin/data-source/template' }

  const connectSheet = () => {
    const q = sheetInput.trim() ? `?sheet=${encodeURIComponent(sheetInput.trim())}` : ''
    window.location.href = `/api/admin/data-source/google/connect${q}`
  }

  const createSheet = async () => {
    setCreating(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/data-source/google/create', { method: 'POST', credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: body.error || `Could not create sheet (${res.status})` }); return }
      if (body.spreadsheetId) setSheetInput(body.spreadsheetId)
      setNotice({ kind: 'ok', text: 'Created your template sheet. Fill it in, then Sync now.' })
      await loadGsheet()
    } finally {
      setCreating(false)
    }
  }

  const syncNow = async () => {
    setSyncing(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/data-source/google/sync', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetInput.trim() ? { sheet: sheetInput.trim() } : {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: body.error || `Sync failed (${res.status})` }); return }
      setNotice({ kind: 'ok', text: `Queued Google Sheet import of ${body.totalRows} rows.` })
      await Promise.all([loadJobs(), loadGsheet()])
    } finally {
      setSyncing(false)
    }
  }

  const reconcile = async (decision: 'approve' | 'keep') => {
    const jobId = gsheet.lastSync?.id
    if (!jobId) return
    setReconciling(true); setNotice(null)
    try {
      const res = await fetch('/api/admin/data-source/google/reconcile', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, decision }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: body.error || `Reconcile failed (${res.status})` }); return }
      setNotice({
        kind: 'ok',
        text: decision === 'approve'
          ? `Removed ${body.applied} product(s) no longer in the sheet.`
          : `Kept ${body.applied} product(s); they're now unmanaged by the sheet.`,
      })
      await Promise.all([loadJobs(), loadGsheet()])
    } finally {
      setReconciling(false)
    }
  }

  const onDisconnected = async (result: { kind: 'ok' | 'err'; text: string }) => {
    setNotice(result)
    if (result.kind === 'ok') setSheetInput('')
    await Promise.all([loadJobs(), loadGsheet()])
  }

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setNotice(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/data-source/import', { method: 'POST', credentials: 'include', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ kind: 'err', text: body.error || `Upload failed (${res.status})` }); return }
      setNotice({ kind: 'ok', text: `Queued import of ${body.totalRows} rows. Processing in the background.` })
      await loadJobs()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return }
    setExpanded(id); setDetail(null)
    const res = await fetch(`/api/admin/data-source/jobs/${id}`, { credentials: 'include' })
    if (res.ok) setDetail((await res.json()).job)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'import', label: 'Import' },
    ...(gsheet.enabled ? [{ key: 'google_sheet' as Tab, label: 'Google Sheet' }] : []),
    { key: 'history', label: 'History' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex border-b border-border-default gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => selectTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400'
                : 'border-transparent text-foreground-secondary hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`text-sm ${notice.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{notice.text}</p>
      )}

      {tab === 'import' && (
        <section className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Import products</h2>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={downloadTemplate}
              className="inline-flex items-center rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-secondary"
            >
              Download template (.xlsx)
            </button>
            {canWrite ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={onUpload}
                  disabled={uploading}
                  className="hidden"
                  id="ds-upload"
                />
                <label
                  htmlFor="ds-upload"
                  className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium cursor-pointer text-white bg-blue-600 shadow-sm ${uploading ? 'opacity-60 cursor-wait' : 'hover:bg-blue-700'}`}
                >
                  {uploading ? 'Uploading…' : 'Upload filled sheet'}
                </label>
              </>
            ) : (
              <span className="text-sm text-foreground-secondary">Read-only — you need products:write to import.</span>
            )}
          </div>
          <ul className="text-xs text-foreground-secondary list-disc pl-5 space-y-1">
            <li>One row per unit: <code>row_type</code> = product / variant / sub_variant, linked by <code>parent_sku</code> / <code>variant_sku</code>.</li>
            <li>Existing SKU updates; new SKU creates. Category &amp; brand must already exist (by name) or the row errors.</li>
            <li><code>image_urls</code> is pipe-delimited (<code>a.jpg|b.jpg</code>); images are fetched and uploaded in the background.</li>
          </ul>
        </section>
      )}

      {tab === 'google_sheet' && gsheet.enabled && (
        <section className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Google Sheet sync</h2>
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${gsheet.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
              {gsheet.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="text-xs text-foreground-secondary">
            Connect your Google account, then create a template sheet in your own Drive with one click —
            we copy the master template for you. Fill it in and Sync now. Or paste an existing sheet&apos;s
            link below. Connecting requests access to sheets you own; you&apos;ll be asked to grant consent.
          </p>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <dt className="text-foreground-secondary">Connection</dt>
              <dd className="font-medium text-foreground">{gsheet.connected ? 'Connected' : 'Not connected'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-foreground-secondary">Sheet</dt>
              <dd className="font-medium text-foreground truncate">
                {gsheet.spreadsheetId ? (
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${gsheet.spreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {gsheet.spreadsheetId}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {gsheet.lastSync ? (
            <div className="rounded-md border border-border-default bg-surface-secondary/40 p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">Last sync</span>
                <StatusPill status={gsheet.lastSync.status} />
                <span className="text-xs text-foreground-secondary">
                  {new Date(gsheet.lastSync.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-foreground-secondary">Rows <span className="text-foreground">{gsheet.lastSync.processedRows}/{gsheet.lastSync.totalRows}</span></span>
                <span className="text-green-600">Created {gsheet.lastSync.createdCount}</span>
                <span className="text-blue-600">Updated {gsheet.lastSync.updatedCount}</span>
                <span className="text-red-600">Errors {gsheet.lastSync.errorCount}</span>
                <span className="text-foreground-secondary">
                  Images {gsheet.lastSync.imageProgress?.fetched ?? 0}/{gsheet.lastSync.imageProgress?.total ?? 0}
                  {gsheet.lastSync.imageProgress?.failed ? ` (${gsheet.lastSync.imageProgress.failed} failed)` : ''}
                </span>
              </div>
              {gsheet.lastSync.lastError && (
                <p className="text-sm text-red-600">Error: {gsheet.lastSync.lastError}</p>
              )}
            </div>
          ) : (
            gsheet.connected && <p className="text-sm text-foreground-secondary">No sync run yet.</p>
          )}

          {gsheet.lastSync && gsheet.lastSync.pendingDeletions?.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {gsheet.lastSync.pendingDeletions.length} product(s) are no longer in the sheet
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  These were synced before but have since been removed from the connected sheet. Approving
                  removal deletes products with no order history and deactivates the rest. Keeping them stops
                  the sheet from managing them.
                </p>
              </div>
              <ul className="max-h-40 overflow-y-auto text-sm text-foreground list-disc pl-5 space-y-0.5">
                {gsheet.lastSync.pendingDeletions.map(p => (
                  <li key={p.productId}>{p.name} <span className="text-foreground-secondary">({p.sku})</span></li>
                ))}
              </ul>
              {canWrite && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => reconcile('approve')}
                    disabled={reconciling}
                    className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-white bg-red-600 shadow-sm ${reconciling ? 'opacity-60 cursor-wait' : 'hover:bg-red-700'}`}
                  >
                    {reconciling ? 'Working…' : 'Approve removal'}
                  </button>
                  <button
                    onClick={() => reconcile('keep')}
                    disabled={reconciling}
                    className={`inline-flex items-center rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground ${reconciling ? 'opacity-60 cursor-wait' : 'hover:bg-surface-secondary'}`}
                  >
                    Keep
                  </button>
                </div>
              )}
            </div>
          )}

          {canWrite ? (
            <div className="space-y-3">
              <input
                type="text"
                value={sheetInput}
                onChange={e => setSheetInput(e.target.value)}
                placeholder="Google Sheet URL or ID"
                className="w-full max-w-xl rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-foreground"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={connectSheet}
                  className="inline-flex items-center rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-secondary"
                >
                  {gsheet.connected ? 'Reconnect Google' : 'Connect Google'}
                </button>
                {gsheet.connected && !gsheet.spreadsheetId && (
                  <button
                    onClick={createSheet}
                    disabled={creating}
                    className={`inline-flex items-center rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground ${creating ? 'opacity-60 cursor-wait' : 'hover:bg-surface-secondary'}`}
                  >
                    {creating ? 'Creating…' : 'Create sheet from template'}
                  </button>
                )}
                <button
                  onClick={syncNow}
                  disabled={!gsheet.connected || syncing}
                  className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-white bg-blue-600 shadow-sm ${(!gsheet.connected || syncing) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-700'}`}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                {gsheet.connected && <GoogleSheetDisconnect onDone={onDisconnected} />}
              </div>
            </div>
          ) : (
            <span className="text-sm text-foreground-secondary">Read-only — you need products:write to sync.</span>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Import history</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-foreground-secondary">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary text-left text-foreground-secondary">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Progress</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Errors</th>
                    <th className="px-3 py-2 font-medium">Images</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => (
                    <RowGroup
                      key={j.id}
                      job={j}
                      expanded={expanded === j.id}
                      detail={expanded === j.id ? detail : null}
                      onToggle={() => toggleDetail(j.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function RowGroup({ job, expanded, detail, onToggle }: {
  job: ImportJob; expanded: boolean; detail: ImportJob | null; onToggle: () => void
}) {
  const img = job.image_progress || { total: 0, fetched: 0, failed: 0 }
  const rows = detail?.row_results ?? job.row_results ?? []
  return (
    <>
      <tr className="border-t border-border-default">
        <td className="px-3 py-2 text-foreground-secondary">{new Date(job.created_at).toLocaleString()}</td>
        <td className="px-3 py-2">{job.source === 'google_sheet' ? 'Google Sheet' : 'Upload'}</td>
        <td className="px-3 py-2"><StatusPill status={job.status} /></td>
        <td className="px-3 py-2">{job.processed_rows}/{job.total_rows}</td>
        <td className="px-3 py-2 text-green-600">{job.created_count}</td>
        <td className="px-3 py-2 text-blue-600">{job.updated_count}</td>
        <td className="px-3 py-2 text-red-600">{job.error_count}</td>
        <td className="px-3 py-2 text-foreground-secondary">{img.fetched}/{img.total}{img.failed ? ` (${img.failed} failed)` : ''}</td>
        <td className="px-3 py-2 text-right">
          <button onClick={onToggle} className="text-blue-600 hover:underline">{expanded ? 'Hide' : 'Details'}</button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border-default bg-surface-secondary/40">
          <td colSpan={9} className="px-3 py-3">
            {job.last_error && <p className="text-sm text-red-600 mb-2">Job error: {job.last_error}</p>}
            {rows.length === 0 ? (
              <p className="text-sm text-foreground-secondary">No per-row results yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-foreground-secondary">
                    <tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Outcome</th><th className="px-2 py-1">Message</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-border-default/60">
                        <td className="px-2 py-1">{r.row}</td>
                        <td className="px-2 py-1">{r.sku ?? '—'}</td>
                        <td className="px-2 py-1"><OutcomePill outcome={r.outcome} /></td>
                        <td className="px-2 py-1 text-foreground-secondary">{r.message ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function StatusPill({ status }: { status: ImportJob['status'] }) {
  const map: Record<ImportJob['status'], string> = {
    pending: 'bg-gray-100 text-gray-700',
    running: 'bg-amber-100 text-amber-800',
    done: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  }
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>{status}</span>
}

function OutcomePill({ outcome }: { outcome: RowResult['outcome'] }) {
  const map: Record<RowResult['outcome'], string> = {
    created: 'text-green-600',
    updated: 'text-blue-600',
    warning: 'text-amber-600',
    error: 'text-red-600',
    deleted: 'text-red-700',
  }
  return <span className={`font-medium ${map[outcome]}`}>{outcome}</span>
}
