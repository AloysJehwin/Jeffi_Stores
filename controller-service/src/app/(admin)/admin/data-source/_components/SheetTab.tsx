'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, FilePlus2, Link2, RefreshCw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { Badge, Banner, Section, btnGhost, btnPrimary, inputCls, when } from '@/components/admin/channels/ui'
import GoogleSheetDisconnect from './GoogleSheetDisconnect'
import JobDetail from './JobDetail'
import { ACTIVE, JobBadge, duration, sheetUrl, type GsheetStatus } from './shared'

export function connectHref(sheet?: string) {
  const s = sheet?.trim()
  return `/api/admin/data-source/google/connect${s ? `?sheet=${encodeURIComponent(s)}` : ''}`
}

async function post(url: string, json?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json ?? {}),
    })
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
  } catch {
    return { ok: false, status: 0, data: { error: 'The connection dropped. Check your network and try again.' } }
  }
}

/** Run a sheet sync; shared by the tab and the Sync action on the tab line. */
export async function runSheetSync(sheet?: string) {
  return post('/api/admin/data-source/google/sync', sheet?.trim() ? { sheet: sheet.trim() } : {})
}

export default function SheetTab({ gsheet, reload }: { gsheet: GsheetStatus; reload: () => Promise<void> }) {
  const canWrite = useCanWrite('products')
  const { showToast, showConfirm } = useToast()
  const [sheetInput, setSheetInput] = useState(gsheet.spreadsheetId ?? '')
  const [busy, setBusy] = useState<'create' | 'sync' | 'reconcile' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [selected, setSelected] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (gsheet.spreadsheetId) setSheetInput(prev => prev || gsheet.spreadsheetId!)
  }, [gsheet.spreadsheetId])

  const state = gsheet.state ?? (gsheet.connected ? 'connected' : 'not_connected')
  const last = gsheet.lastSync
  const syncing = !!last && ACTIVE.has(last.status)
  const pending = last?.status === 'done' ? (last.pendingDeletions ?? []) : []
  const chosen = selected ?? new Set(pending.map(p => p.productId))
  const sheetChanged = !!sheetInput.trim() && sheetInput.trim() !== gsheet.spreadsheetId && !sheetInput.includes(gsheet.spreadsheetId ?? '\u0000')

  const finish = async (ok: boolean, text: string) => {
    setResult({ ok, text })
    showToast(text, ok ? 'success' : 'error')
    await reload()
  }

  const createSheet = async () => {
    setBusy('create')
    setResult(null)
    const r = await post('/api/admin/data-source/google/create')
    if (r.ok && r.data.spreadsheetId) setSheetInput(r.data.spreadsheetId)
    await finish(r.ok, r.ok ? 'Created a template sheet in your Google Drive. Fill it in, then Sync now.' : r.data.error || `Could not create the sheet (${r.status}).`)
    setBusy(null)
  }

  const syncNow = async () => {
    setBusy('sync')
    setResult(null)
    const r = await runSheetSync(sheetChanged ? sheetInput : undefined)
    const extra = r.ok && r.data.invalid ? ` ${r.data.invalid} row(s) already have problems and will be skipped.` : ''
    await finish(r.ok, r.ok ? `Sync queued: ${r.data.totalRows} row(s) from the sheet.${extra}` : r.data.error || `Sync failed (${r.status}).`)
    setBusy(null)
  }

  const reconcile = async (decision: 'approve' | 'keep') => {
    if (!last || chosen.size === 0) return
    if (decision === 'approve') {
      const ok = await showConfirm({
        title: `Remove ${chosen.size} product(s)?`,
        message: 'Products with no order history are deleted; products with orders are deactivated instead. This cannot be undone.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        type: 'danger',
      })
      if (!ok) return
    }
    setBusy('reconcile')
    setResult(null)
    const all = chosen.size === pending.length
    const r = await post('/api/admin/data-source/google/reconcile', {
      jobId: last.id,
      decision,
      ...(all ? {} : { productIds: [...chosen] }),
    })
    setSelected(null)
    await finish(
      r.ok,
      r.ok
        ? decision === 'approve'
          ? `Removed ${r.data.applied} product(s) that left the sheet.`
          : `Kept ${r.data.applied} product(s); they are now managed manually.`
        : r.data.error || `Could not apply the decision (${r.status}).`
    )
    setBusy(null)
  }

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-4">
        <Section
          title="Connection"
          action={
            <Badge tone={state === 'connected' ? 'green' : state === 'needs_reconnect' ? 'red' : 'muted'}>
              {state === 'connected' ? 'Connected' : state === 'needs_reconnect' ? 'Reconnect needed' : 'Not connected'}
            </Badge>
          }
        >
          {state === 'needs_reconnect' && (
            <div className="mb-3">
              <Banner ok={false}>Google refused the saved sign-in (it expired or access was removed). Reconnect to keep syncing.</Banner>
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="Google account" value={gsheet.account || (state === 'not_connected' ? '-' : 'Connected (email not recorded)')} />
            <Field label="Connected" value={gsheet.connectedAt ? when(gsheet.connectedAt) : '-'} />
            <Field
              label="Sheet"
              value={
                gsheet.spreadsheetId ? (
                  <a href={sheetUrl(gsheet.spreadsheetId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-500 hover:underline break-all">
                    Open in Google Sheets <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  'None yet'
                )
              }
            />
            <Field label="Schedule" value="Manual: syncs run when you press Sync now" />
          </dl>
        </Section>

        <Section title="Last sync" action={last ? <JobBadge status={last.status} errors={last.errorCount} /> : undefined}>
          {last ? (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">
                Started {when(last.createdAt)}
                {duration(last.createdAt, last.finishedAt) ? `, took ${duration(last.createdAt, last.finishedAt)}` : ''}
              </p>
              <JobDetail key={`${last.id}:${last.status}`} id={last.id} compact />
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">{state === 'connected' ? 'No sync yet. Create or link a sheet, then Sync now.' : 'Connect Google to sync products from a sheet.'}</p>
          )}
        </Section>

        {pending.length > 0 && (
          <Section title={`${pending.length} product(s) left the sheet`}>
            <p className="text-sm text-foreground-secondary mb-3">
              These were synced from the sheet before and are missing from the latest sync. Remove deletes products without orders and deactivates the rest; Keep leaves them in the
              store as manually managed.
            </p>
            <ul className="max-h-56 overflow-y-auto divide-y divide-border-default rounded-lg border border-border-default">
              {pending.map(p => (
                <li key={p.productId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {canWrite && <input type="checkbox" aria-label={`Select ${p.name}`} checked={chosen.has(p.productId)} onChange={() => toggle(p.productId)} />}
                  <span className="text-foreground truncate">{p.name}</span>
                  <span className="ml-auto font-mono text-xs text-foreground-muted">{p.sku}</span>
                </li>
              ))}
            </ul>
            {canWrite && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => reconcile('approve')} disabled={!!busy || syncing || chosen.size === 0} className={`${btnPrimary} !bg-red-600 hover:!bg-red-700`}>
                  {busy === 'reconcile' ? 'Working...' : `Remove ${chosen.size === pending.length ? 'all' : chosen.size}`}
                </button>
                <button type="button" onClick={() => reconcile('keep')} disabled={!!busy || syncing || chosen.size === 0} className={btnGhost}>
                  Keep {chosen.size === pending.length ? 'all' : chosen.size}
                </button>
              </div>
            )}
          </Section>
        )}
      </div>

      <div className="lg:col-span-2 space-y-4">
        <Section title="Actions">
          {!canWrite ? (
            <p className="text-sm text-foreground-muted">Read-only: you need products write access to connect or sync a sheet.</p>
          ) : (
            <div className="space-y-4">
              {result && <Banner ok={result.ok}>{result.text}</Banner>}
              <Action
                title={state === 'not_connected' ? 'Connect Google' : 'Reconnect Google'}
                text="Sign in with Google and allow reading your sheets and creating the template sheet."
              >
                <a href={connectHref(sheetChanged ? sheetInput : undefined)} className={state === 'connected' ? btnGhost : btnPrimary}>
                  <Link2 className="w-4 h-4" /> {state === 'not_connected' ? 'Connect' : 'Reconnect'}
                </a>
              </Action>
              <Action title="Create sheet" text="Make a new sheet from the import template in your Google Drive and use it for syncs.">
                <button type="button" onClick={createSheet} disabled={state !== 'connected' || !!busy || gsheet.canCreate === false} className={btnGhost}>
                  <FilePlus2 className="w-4 h-4" /> {busy === 'create' ? 'Creating...' : 'Create sheet'}
                </button>
                {state === 'connected' && gsheet.canCreate === false && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Drive access was not granted. Reconnect and allow it to create sheets.</p>
                )}
              </Action>
              <Action title="Sync now" text="Read the sheet and create or update products by SKU. Runs in the background; progress shows on the left.">
                <input
                  value={sheetInput}
                  onChange={e => setSheetInput(e.target.value)}
                  placeholder="Sheet link or id (optional)"
                  aria-label="Google Sheet link or id"
                  className={`${inputCls} mb-2`}
                />
                <button type="button" onClick={syncNow} disabled={state !== 'connected' || !!busy || syncing} className={btnPrimary}>
                  <RefreshCw className={`w-4 h-4 ${busy === 'sync' || syncing ? 'animate-spin' : ''}`} />
                  {busy === 'sync' ? 'Queuing...' : syncing ? 'Sync running' : sheetChanged ? 'Use this sheet and sync' : 'Sync now'}
                </button>
              </Action>
              {state !== 'not_connected' && (
                <Action title="Disconnect" text="Stop syncing. Products already synced stay in the store and become manually managed.">
                  <GoogleSheetDisconnect
                    disabled={!!busy || syncing}
                    onDone={async r => {
                      if (r.kind === 'ok') setSheetInput('')
                      await finish(r.kind === 'ok', r.text)
                    }}
                  />
                </Action>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="text-foreground truncate">{value}</dd>
    </div>
  )
}

function Action({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-foreground-muted">{text}</p>
      <div>{children}</div>
    </div>
  )
}
