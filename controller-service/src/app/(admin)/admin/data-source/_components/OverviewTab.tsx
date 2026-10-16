'use client'

import Link from 'next/link'
import { AttentionList, OverviewSkeleton, useOverviewData, type AttentionItem } from '@/components/admin/overview/kit'
import { Banner, Kpi, KpiGrid, when } from '@/components/admin/channels/ui'
import { STALE_JOB_MESSAGE } from './shared-constants'
import { duration, jobState, sheetUrl, sourceLabel, type GsheetStatus, type ImportJob } from './shared'

interface OverviewData {
  stats: {
    days: number
    jobs: number
    created: number
    updated: number
    failedRows: number
    failedJobs: number
    withErrors: number
    lastImport: ImportJob | null
    active: ImportJob[]
    stuck: ImportJob[]
    waiting: ImportJob[]
  }
  gsheet: GsheetStatus
  catalog: {
    total: number
    active: number
    from_sheet: number
    from_import: number
    no_category: number
    no_brand: number
    no_price: number
  } | null
  reset?: number
}

const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '-' : v.toLocaleString('en-IN'))

/** Default tab: catalogue size, 30-day import results, and jobs that need attention. */
export default function OverviewTab({ refreshKey, onGoto }: { refreshKey: number; onGoto: (tab: 'import' | 'google_sheet' | 'history') => void }) {
  const { data, loading, error, reload } = useOverviewData<OverviewData>(`/api/admin/data-source/overview?k=${refreshKey}`)
  if (error && !loading) {
    return (
      <div className="space-y-2">
        <Banner ok={false}>{error}</Banner>
        <button type="button" onClick={reload} className="text-sm text-accent-500 hover:underline">
          Try again
        </button>
      </div>
    )
  }
  if (loading || !data) return <OverviewSkeleton />
  const { stats, gsheet, catalog } = data

  const lastImportTone = stats.lastImport ? jobState(stats.lastImport.status, stats.lastImport.error_count).label : 'None yet'
  const lastSyncTone = gsheet.lastSync ? jobState(gsheet.lastSync.status, gsheet.lastSync.errorCount).label : 'None yet'

  const items: AttentionItem[] = []
  if ((data.reset ?? 0) > 0) {
    items.push({ key: 'reset', severity: 'critical', title: `${data.reset} import(s) stopped mid-run and were marked failed`, sub: STALE_JOB_MESSAGE })
  }
  for (const j of stats.stuck) {
    items.push({ key: `stuck:${j.id}`, severity: 'critical', title: `An import stopped mid-run`, sub: `${sourceLabel(j.source)}, ${when(j.updated_at)} - ${STALE_JOB_MESSAGE}` })
  }
  for (const j of stats.waiting) {
    items.push({ key: `wait:${j.id}`, severity: 'warning', title: 'A queued import has not started', sub: `${sourceLabel(j.source)}, queued ${when(j.created_at)}` })
  }
  if (gsheet.state === 'needs_reconnect') {
    items.push({ key: 'reauth', severity: 'critical', title: 'Google refused the saved sign-in', sub: 'Reconnect to keep syncing.' })
  } else if (gsheet.connected && gsheet.canCreate === false) {
    items.push({ key: 'scope', severity: 'warning', title: 'Google Drive access not granted', sub: 'You can sync, but Create sheet is disabled. Reconnect and allow Drive to enable it.' })
  }
  if (gsheet.lastSync && gsheet.lastSync.status === 'done' && (gsheet.lastSync.pendingDeletions?.length ?? 0) > 0) {
    const c = gsheet.lastSync.pendingDeletions!.length
    items.push({ key: 'orphans', severity: 'warning', title: `${c} product(s) left the sheet`, sub: 'Decide whether to remove them or keep them manually managed.' })
  }
  if (gsheet.lastSync && gsheet.lastSync.status === 'done' && gsheet.lastSync.errorCount > 0) {
    items.push({ key: 'sheet-errors', severity: 'warning', title: `Last sync skipped ${gsheet.lastSync.errorCount} row(s)`, sub: 'Open the sheet, fix the rows and sync again.' })
  }
  if (stats.lastImport?.status === 'failed') {
    items.push({ key: 'last-failed', severity: 'critical', title: 'Last file import failed', sub: stats.lastImport.last_error || 'Upload the file again.' })
  } else if (stats.lastImport?.status === 'done' && stats.lastImport.error_count > 0) {
    items.push({ key: 'last-err', severity: 'warning', title: `Last import skipped ${stats.lastImport.error_count} row(s)`, sub: 'Fix those rows and upload the file again.' })
  }
  if (catalog && catalog.active > 0) {
    if (catalog.no_price > 0) items.push({ key: 'no-price', severity: 'warning', title: `${n(catalog.no_price)} active product(s) without a price`, sub: 'The template\'s base_price catches these.' })
    if (catalog.no_category > 0) items.push({ key: 'no-cat', severity: 'info', title: `${n(catalog.no_category)} active product(s) without a category`, sub: 'Set category in the template.' })
    if (catalog.no_brand > 0) items.push({ key: 'no-brand', severity: 'info', title: `${n(catalog.no_brand)} active product(s) without a brand`, sub: 'Set brand in the template.' })
  }

  const needsNudge = items.length === 0 && stats.jobs === 0 ? 'No imports in the last 30 days.' : undefined

  return (
    <div className="space-y-4">
      <KpiGrid>
        <Kpi label="Products in catalogue" value={n(catalog?.total)} sub={catalog ? `${n(catalog.active)} active` : undefined} />
        <Kpi label="Created or updated (30d)" value={n(stats.created + stats.updated)} sub={`${n(stats.created)} new, ${n(stats.updated)} updated`} />
        <Kpi label="Last file import" value={lastImportTone} sub={stats.lastImport ? when(stats.lastImport.created_at) : undefined} />
        <Kpi label="Last sheet sync" value={lastSyncTone} sub={gsheet.lastSync ? `${when(gsheet.lastSync.createdAt)}${duration(gsheet.lastSync.createdAt, gsheet.lastSync.finishedAt) ? `, ${duration(gsheet.lastSync.createdAt, gsheet.lastSync.finishedAt)}` : ''}` : undefined} />
        <Kpi label="Skipped rows (30d)" value={n(stats.failedRows)} sub={stats.jobs ? `${n(stats.withErrors + stats.failedJobs)} of ${n(stats.jobs)} job(s)` : undefined} highlight={stats.failedRows > 0} />
        <Kpi
          label="Google Sheet"
          value={gsheet.state === 'connected' ? 'Connected' : gsheet.state === 'needs_reconnect' ? 'Reconnect' : 'Not connected'}
          sub={gsheet.spreadsheetId ? 'Sheet linked' : gsheet.state === 'connected' ? 'No sheet yet' : undefined}
          highlight={gsheet.state === 'needs_reconnect'}
        />
      </KpiGrid>

      <AttentionList items={items} empty={needsNudge ?? 'Nothing needs attention right now.'} />

      <div className="grid gap-4 md:grid-cols-2">
        <QuickCard title="Upload a file" text="Download the template, fill it in and upload. New SKUs are created; existing ones are updated." cta="Open Import" onClick={() => onGoto('import')} />
        <QuickCard
          title="Google Sheet sync"
          text={gsheet.spreadsheetId ? 'Edit your connected sheet, then run a sync.' : gsheet.connected ? 'Create a template sheet in Drive, or paste a link.' : 'Connect a Google account to sync products from a sheet.'}
          cta={gsheet.spreadsheetId ? 'Open sheet' : 'Open Google Sheet'}
          href={gsheet.spreadsheetId ? sheetUrl(gsheet.spreadsheetId) : undefined}
          external={!!gsheet.spreadsheetId}
          onClick={() => onGoto('google_sheet')}
        />
      </div>
    </div>
  )
}

function QuickCard({ title, text, cta, onClick, href, external }: { title: string; text: string; cta: string; onClick?: () => void; href?: string; external?: boolean }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-sm text-foreground-muted flex-1">{text}</p>
      <div className="flex gap-2">
        {href && external ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-sm text-accent-500 hover:underline">
            {cta}
          </a>
        ) : href ? (
          <Link href={href} className="text-sm text-accent-500 hover:underline">
            {cta}
          </Link>
        ) : (
          <button type="button" onClick={onClick} className="text-sm text-accent-500 hover:underline">
            {cta}
          </button>
        )}
      </div>
    </div>
  )
}
