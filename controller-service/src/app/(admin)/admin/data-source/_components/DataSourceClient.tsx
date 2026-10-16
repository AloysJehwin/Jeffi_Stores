'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Download, RefreshCw, UploadCloud } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { Tabs, TabActionsHost } from '@/components/admin/channels/ui'
import { ACTIVE, EMPTY_GSHEET, type GsheetStatus } from './shared'
import OverviewTab from './OverviewTab'
import ImportTab from './ImportTab'
import SheetTab, { runSheetSync } from './SheetTab'
import HistoryTab from './HistoryTab'

type Tab = 'overview' | 'import' | 'google_sheet' | 'history'
const TAB_KEYS: Tab[] = ['overview', 'import', 'google_sheet', 'history']

export default function DataSourceClient({ initialGsheet }: { initialGsheet?: GsheetStatus }) {
  const canWrite = useCanWrite('products')
  const { showToast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab') as Tab | null
  const tab: Tab = requestedTab && TAB_KEYS.includes(requestedTab) ? requestedTab : 'overview'

  // One number drives every tab's SWR key, so a refresh or a mutation reloads them in step.
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey(k => k + 1), [])

  const [gsheet, setGsheet] = useState<GsheetStatus>(initialGsheet ?? EMPTY_GSHEET)

  const loadGsheet = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/data-source/google/status', { credentials: 'include' })
      if (res.ok) setGsheet(await res.json())
    } catch {
      // The tab will refetch on its next interaction.
    }
  }, [])
  useEffect(() => {
    loadGsheet()
  }, [loadGsheet, refreshKey])

  // While a sheet sync is queued or running, keep its status fresh so the tab, the Sync button and
  // the removed-from-sheet list update when it finishes.
  const sheetActive = !!gsheet.lastSync && ACTIVE.has(gsheet.lastSync.status)
  useEffect(() => {
    if (!sheetActive) return
    const t = setInterval(loadGsheet, 5000)
    return () => clearInterval(t)
  }, [sheetActive, loadGsheet])

  // The Google connect flow returns here with ?connected=&error=&tab=; show the outcome once, then drop it.
  const shownReturn = useRef<string | null>(null)
  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected === null) return
    const key = searchParams.toString()
    if (shownReturn.current === key) return
    shownReturn.current = key
    const err = searchParams.get('error')
    if (connected === '0') showToast(returnMessage(err), 'error')
    else showToast('Google account connected.', 'success')
    const next = new URLSearchParams(key)
    next.delete('connected')
    next.delete('error')
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false })
    bump()
  }, [searchParams, pathname, router, showToast, bump])

  const selectTab = useCallback(
    (next: Tab) => {
      const q = new URLSearchParams(searchParams.toString())
      if (next === 'overview') q.delete('tab')
      else q.set('tab', next)
      router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const [syncing, setSyncing] = useState(false)
  const syncNow = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const r = await runSheetSync()
      if (r.ok) {
        const skipped = r.data.invalid ? ` ${r.data.invalid} row(s) already have problems and will be skipped.` : ''
        showToast(`Sync queued: ${r.data.totalRows} row(s) from the sheet.${skipped}`, 'success')
        bump()
      } else {
        showToast(r.data.error || `Sync failed (${r.status}).`, 'error')
      }
    } finally {
      setSyncing(false)
    }
  }, [bump, showToast, syncing])

  const chooseFile = useCallback(() => {
    selectTab('import')
    setTimeout(() => document.querySelector<HTMLInputElement>('#ds-upload')?.click(), 50)
  }, [selectTab])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'import', label: 'Import file' },
    { id: 'google_sheet', label: 'Google Sheet' },
    { id: 'history', label: 'History' },
  ]

  const canSync = canWrite && gsheet.state === 'connected'

  const actions = (
    <>
      <a
        href="/api/admin/data-source/template"
        aria-label="Download Excel template"
        title="Download Excel template"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2 sm:px-3 py-1.5 text-sm text-foreground hover:bg-surface-secondary whitespace-nowrap"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Template</span>
      </a>
      {canWrite && tab !== 'import' && (
        <button
          type="button"
          onClick={chooseFile}
          aria-label="Upload a spreadsheet"
          title="Upload a spreadsheet"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-2 sm:px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 whitespace-nowrap"
        >
          <UploadCloud className="w-4 h-4" />
          <span className="hidden sm:inline">Upload</span>
        </button>
      )}
      {canSync && (
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing || sheetActive}
          aria-label="Sync Google Sheet now"
          title="Sync Google Sheet now"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2 sm:px-3 py-1.5 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50 whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${syncing || sheetActive ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{syncing || sheetActive ? 'Syncing' : 'Sync'}</span>
        </button>
      )}
      <button
        type="button"
        onClick={bump}
        aria-label="Refresh"
        title="Refresh"
        className="inline-flex items-center justify-center rounded-lg p-1.5 text-foreground-muted hover:text-foreground hover:bg-surface-elevated"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </>
  )

  return (
    <TabActionsHost>
      <div className="space-y-4">
        <Tabs tabs={tabs} value={tab} onChange={selectTab} actions={actions} />
        {tab === 'overview' && <OverviewTab refreshKey={refreshKey} onGoto={selectTab} />}
        {tab === 'import' && <ImportTab refreshKey={refreshKey} onQueued={bump} />}
        {tab === 'google_sheet' && <SheetTab gsheet={gsheet} reload={async () => (await loadGsheet(), bump())} />}
        {tab === 'history' && <HistoryTab refreshKey={refreshKey} />}
      </div>
    </TabActionsHost>
  )
}

function returnMessage(error: string | null): string {
  if (!error) return 'Google connection failed.'
  const low = error.toLowerCase()
  if (low === 'access_denied') return 'Google sign-in was cancelled.'
  if (low === 'bad_state' || low === 'missing_params') return 'Google sign-in return was invalid. Try again from this page.'
  if (low === 'sheets_scope_denied') return 'Google sign-in needs the "View your Google Sheets" permission. Try again and allow it.'
  if (low === 'not_configured') return 'Google sign-in is not configured on this server.'
  if (low === 'exchange_failed' || low === 'save_failed') return 'Could not complete Google sign-in. Try again.'
  return 'Google connection failed. Try again.'
}
