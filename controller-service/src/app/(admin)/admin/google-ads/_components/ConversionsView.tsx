'use client'

import { useCallback, useEffect, useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { Ban, KeyRound, Plus, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { money, count, pct, humanize, formatCid } from '@/lib/google-ads/format'
import {
  SERVER_ACTION_NAME,
  UPLOAD_STATUSES,
  type ConversionAuth,
  type ConversionsSummary,
  type DataManagerRequest,
  type GoogleConversionAction,
  type GoogleConversionsData,
  type OfflineDiagnostics,
  type ReasonCount,
  type RequestStatus,
  type UploadApi,
  type UploadLog,
  type UploadRow,
  type UploadStatus,
} from '@/lib/google-ads/conversions/types'
import { Section, Empty, Table } from './ReportViews'

// Server-side purchase conversions: where they upload, Google's view of the account, and the queue.

const STATUS_TONE: Record<UploadStatus, 'green' | 'amber' | 'red' | 'muted'> = {
  uploaded: 'green',
  pending: 'amber',
  failed: 'red',
  skipped: 'muted',
}

const Badge = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'red' | 'amber' | 'green' | 'muted' }) => {
  const cls = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    green: 'bg-green-500/10 text-green-700 dark:text-green-400',
    muted: 'bg-surface-secondary text-foreground-muted',
  }[tone]
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
const actionId = (resource: string | null | undefined) => String(resource ?? '').split('/').pop() || '-'
const reasonLabel = (r: string) => humanize(r.replace(/^PROCESSING_(ERROR|WARNING)_(REASON_)?/, ''))
const reasons = (list: ReasonCount[]) => list.map(c => `${reasonLabel(c.reason)} x${c.count}`).join(', ')

const REQUEST_LABEL: Record<RequestStatus, { text: string; tone: 'green' | 'amber' | 'red' | 'muted' }> = {
  PROCESSING: { text: 'Processing', tone: 'amber' },
  SUCCESS: { text: 'Accepted', tone: 'green' },
  PARTIAL_SUCCESS: { text: 'Partly rejected', tone: 'amber' },
  FAILED: { text: 'Rejected', tone: 'red' },
  UNKNOWN: { text: 'No status', tone: 'muted' },
  TIMED_OUT: { text: 'No status', tone: 'muted' },
}
const RECONNECT_URL = '/api/admin/integrations/google-ads/connect?reconnect=1'

async function send(url: string, method: 'POST' | 'DELETE', body?: unknown) {
  const r = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
}

export default function ConversionsView({ d, currency }: { d: ConversionsSummary; currency: string }) {
  const canWrite = useCanWrite('google_ads')
  const [summary, setSummary] = useState(d)
  const [google, setGoogle] = useState<GoogleConversionsData | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const toast = useActionToast()
  const setBanner = useCallback((b: { ok: boolean; text: string } | null) => b && toast.result(b), [toast])
  const [busy, setBusy] = useState<string | null>(null)
  const [primary, setPrimary] = useState(!d.browserConversion)
  const [logKey, setLogKey] = useState(0)
  const [requests, setRequests] = useState<DataManagerRequest[] | null>(null)
  const [requestsError, setRequestsError] = useState<string | null>(null)

  useEffect(() => setSummary(d), [d])

  const loadGoogle = useCallback(() => {
    setGoogleError(null)
    fetch('/api/admin/google-ads/conversions/google', { credentials: 'include' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not reach Google Ads')
        setGoogle(j)
      })
      .catch(e => setGoogleError(e.message))
  }, [])
  useEffect(() => {
    if (summary.available) loadGoogle()
  }, [loadGoogle, summary.available])

  const loadRequests = useCallback(() => {
    fetch('/api/admin/google-ads/conversions/requests', { credentials: 'include' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not load the upload requests')
        setRequestsError(null)
        setRequests(j.requests ?? [])
      })
      .catch(e => setRequestsError(e.message))
  }, [])
  useEffect(() => {
    if (summary.available) loadRequests()
  }, [loadRequests, summary.available, logKey])

  const refreshSummary = useCallback(async () => {
    const qs = new URLSearchParams({ tab: 'conversions', from: summary.range.from, to: summary.range.to })
    const r = await fetch(`/api/admin/google-ads/report?${qs}`, { credentials: 'include' })
    const j = await r.json().catch(() => ({}))
    if (r.ok && j.data) setSummary(j.data)
  }, [summary.range.from, summary.range.to])

  async function run(kind: string, fn: () => Promise<string>) {
    setBusy(kind)
    setBanner(null)
    try {
      setBanner({ ok: true, text: await fn() })
    } catch (e: any) {
      setBanner({ ok: false, text: e.message })
    } finally {
      setBusy(null)
      await refreshSummary()
      setLogKey(k => k + 1)
    }
  }

  const create = () =>
    run('create', async () => {
      const r = await send('/api/admin/google-ads/conversions/action', 'POST', { mode: 'create', primary })
      loadGoogle()
      return r.created
        ? `Created "${r.action.name}". Google takes uploads to a new action about 6 hours after it is created.`
        : `Using the existing "${r.action.name}" action.`
    })
  const choose = (a: GoogleConversionAction) =>
    run(`use-${a.id}`, async () => {
      await send('/api/admin/google-ads/conversions/action', 'POST', { mode: 'select', resourceName: a.resourceName })
      return `Purchases now upload to "${a.name}".`
    })
  const stop = () =>
    run('stop', async () => {
      await send('/api/admin/google-ads/conversions/action', 'DELETE')
      return 'Uploads stopped. Orders keep queueing and go out once an action is set again.'
    })
  const uploadNow = () =>
    run('upload', async () => {
      const r = await send('/api/admin/google-ads/conversions/upload', 'POST')
      if (r.status === 'not_configured') return 'Nothing uploaded: choose a conversion action first.'
      if (r.error) throw new Error(r.error)
      return `Uploaded ${r.uploaded}, retrying ${r.retrying}, failed ${r.failed}, skipped ${r.skipped}.`
    })
  const setApi = (uploadApi: UploadApi) =>
    run('api', async () => {
      await send('/api/admin/google-ads/conversions/settings', 'POST', { uploadApi })
      return uploadApi === 'ads_api'
        ? 'Conversions now upload through the Google Ads API.'
        : 'Conversions now upload through the Data Manager API.'
    })
  const checkSetup = () =>
    run('check', async () => {
      const r = await send('/api/admin/google-ads/conversions/check', 'POST')
      if (!r.ok) throw new Error(r.message)
      return r.warnings?.length ? `${r.message} Warnings: ${r.warnings.map((w: any) => w.description || w.reason).join('; ')}` : r.message
    })
  const retry = (ids?: number[]) =>
    run(ids ? `retry-${ids[0]}` : 'retry', async () => {
      const r = await send('/api/admin/google-ads/conversions/retry', 'POST', ids ? { ids } : {})
      return `${r.retried} failed upload${r.retried === 1 ? '' : 's'} queued again for the next run.`
    })

  if (!summary.available) {
    return (
      <Section title="Server-side conversions">
        <p className="text-sm text-foreground-muted">
          Conversion uploads need a database update on this store. They start after the next release.
        </p>
      </Section>
    )
  }

  const cfg = summary.config
  const active = !!cfg.action && cfg.matchesAccount
  const dataManager = cfg.uploadApi !== 'ads_api'
  const uploadActions = (google?.actions ?? []).filter(a => a.type === 'UPLOAD_CLICKS' && a.status === 'ENABLED')

  return (
    <div className="space-y-5">
      <Section
        title="Server-side purchases"
        action={
          canWrite && active ? (
            <div className="flex items-center gap-1">
              {dataManager && (
                <IconButton icon={ShieldCheck} label="Check setup" size="sm" busy={busy === 'check'} onClick={checkSetup} />
              )}
              <IconButton icon={Upload} label="Upload now" size="sm" busy={busy === 'upload'} onClick={uploadNow} />
              <IconButton icon={Ban} label="Stop uploading" size="sm" variant="danger" busy={busy === 'stop'} onClick={stop} />
            </div>
          ) : undefined
        }
      >
        <div className="space-y-3 text-sm">
          {dataManager && <AccessNote auth={summary.auth} canWrite={canWrite} />}
          {active ? (
            <p>
              Uploading to <b>{cfg.actionName || 'conversion action'}</b>{' '}
              <span className="text-foreground-muted">
                (id {actionId(cfg.action)}, account {formatCid(cfg.owner)}, set {when(cfg.setAt)})
              </span>
            </p>
          ) : cfg.action ? (
            <p className="text-amber-700 dark:text-amber-400">
              &quot;{cfg.actionName}&quot; was chosen for account {formatCid(cfg.account)}, but {formatCid(cfg.connectedCustomer)} is
              connected now. Choose an action for this account; uploads are paused until then.
            </p>
          ) : (
            <p className="text-foreground-secondary">
              No conversion action yet: orders from Google Ads clicks are queued but not uploaded.
            </p>
          )}

          {canWrite && !active && (
            <div className="rounded-lg border border-border-default p-3 space-y-2">
              <p>
                Create a <b>{SERVER_ACTION_NAME}</b> import action (category Purchase, every purchase counted, 90-day click
                window, INR) and upload to it, or pick an existing import action below.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} />
                Primary (used for bidding)
                {summary.browserConversion && (
                  <span className="text-xs text-foreground-muted">
                    off by default: the Google tag already sends a purchase conversion
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={create}
                disabled={busy === 'create'}
                className="control-sm bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5" />
                {busy === 'create' ? 'Creating...' : `Create "${SERVER_ACTION_NAME}"`}
              </button>
            </div>
          )}

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground-secondary space-y-1">
            <p className="font-medium text-foreground">Count each purchase once</p>
            <p>
              The Google tag&apos;s purchase conversion (Site Controls &gt; Google tag &amp; Ads) and this server conversion see the
              same orders, so only one of them should be primary; make the other secondary. We recommend the server one as
              primary: it also counts buyers whose browser blocked the tag and COD orders once delivered, and it is corrected
              when an order is cancelled or refunded. Change it in Google Ads under Goals &gt; Conversions &gt; Summary &gt; the
              action &gt; Goal and action optimization.
            </p>
          </div>

          {active && <ApiChoice api={cfg.uploadApi} canWrite={canWrite} busy={busy === 'api'} onChange={setApi} />}

          <EnhancedNote google={google} />

          <p className="text-xs text-foreground-muted">
            An order from a Google Ads click is queued when it is paid (COD: when delivered) and uploaded every 30 minutes, at
            least 6 hours after the click. The value is the order total including tax and shipping, the same value the Google tag
            reports. Clicks older than 90 days are skipped.{' '}
            {dataManager
              ? 'Partial refunds and returns restate the value once Google has processed the purchase (at most a day later). Cancellations and full refunds set the value to 0: the Data Manager API cannot remove a conversion, so it still counts once.'
              : 'Cancellations and full refunds are retracted, partial refunds and returns restated, from 24 hours after the purchase.'}
          </p>

          {cfg.lastRun && (
            <p className="text-xs">
              <span className="text-foreground-muted">Last run {when(cfg.lastRunAt)}: </span>
              {cfg.lastRun.uploaded} uploaded, {cfg.lastRun.retrying} retrying, {cfg.lastRun.failed} failed, {cfg.lastRun.skipped}{' '}
              skipped
              {cfg.lastRun.error && <span className="block text-red-600 dark:text-red-400 mt-1">{cfg.lastRun.error}</span>}
            </p>
          )}
        </div>
      </Section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Uploaded" value={count(summary.counts.uploaded)} sub={`${money(summary.uploadedValue, currency)} purchase value`} />
        <Tile label="Pending" value={count(summary.counts.pending)} sub={`${count(summary.backlog.pending)} waiting overall`} />
        <Tile
          label="Failed"
          value={count(summary.counts.failed)}
          sub={`${count(summary.backlog.failed)} failed overall`}
          alert={summary.backlog.failed > 0}
        />
        <Tile label="Skipped" value={count(summary.counts.skipped)} sub="not sent, with a reason" />
      </div>

      <Section title="Conversion actions in Google Ads">
        {googleError ? (
          <p className="text-sm text-red-500">{googleError}</p>
        ) : !google ? (
          <div className="h-24 rounded-lg bg-surface-secondary animate-pulse" />
        ) : (
          <ActionsTable
            actions={google.actions}
            current={active ? cfg.action : null}
            canWrite={canWrite}
            busy={busy}
            onUse={choose}
            uploadable={uploadActions.length}
          />
        )}
        {google?.errors.length ? (
          <ul className="mt-3 text-xs text-red-600 dark:text-red-400 space-y-1">
            {google.errors.map(e => (
              <li key={e.step}>
                <b>{e.step}</b>: {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {(dataManager || !!requests?.length) && (
        <Section title="Google processing (Data Manager API)">
          <RequestsTable requests={requests} error={requestsError} />
        </Section>
      )}

      <Section title="Google Ads import summary">
        <Diagnostics items={google?.diagnostics ?? null} actionName={active ? cfg.actionName : null} />
      </Section>

      <UploadLogSection
        canWrite={canWrite}
        currency={currency}
        reloadKey={logKey}
        failedOverall={summary.backlog.failed}
        busy={busy}
        onRetry={retry}
      />
    </div>
  )
}

function Tile({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className={`bg-surface-elevated border rounded-xl p-4 ${alert ? 'border-red-500/40' : 'border-border-default'}`}>
      <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
      <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-foreground-muted">{sub}</p>}
    </div>
  )
}

function AccessNote({ auth, canWrite }: { auth: ConversionAuth; canWrite: boolean }) {
  if (auth.dataManager === 'unknown' && auth.connectedVia === 'manual') {
    return (
      <p className="text-xs text-foreground-secondary">
        Uploads use the refresh token entered by hand, which needs the Data Manager permission (scope
        https://www.googleapis.com/auth/datamanager). If uploads report a permission error, reconnect with Google sign-in.
      </p>
    )
  }
  if (auth.dataManager !== 'missing') return null
  const own = auth.connectedVia === 'oauth' || auth.connectedVia === 'manual'
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <p className="font-medium text-foreground flex items-center gap-1.5">
        <KeyRound className="w-4 h-4 text-amber-600" />
        {own ? 'Reconnect to enable conversion uploads' : 'Conversion uploads are not allowed yet'}
      </p>
      <p className="text-xs text-foreground-secondary">
        {own
          ? "Conversions go to Google through the Data Manager API, which needs one more permission on the Google sign-in. Reconnect and allow it on Google's consent screen; the connected account stays as it is. Orders keep queueing meanwhile."
          : auth.connectedVia === 'manager'
            ? "The platform's manager connection does not allow Data Manager uploads yet. The platform team needs to re-issue its Google Ads token with the Data Manager permission. Orders keep queueing meanwhile."
            : "The platform service account cannot use the Data Manager API yet: enable the API in its Google Cloud project, give it the Service Usage Consumer role there, and add it as a user (Standard or Admin) in this Google Ads account. Orders keep queueing meanwhile."}
      </p>
      {own &&
        (canWrite ? (
          <a
            href={RECONNECT_URL}
            className="control-sm bg-accent-500 font-medium text-white hover:bg-accent-600"
          >
            Reconnect Google Ads
          </a>
        ) : (
          <p className="text-xs text-foreground-muted">An admin with Google Ads write access can reconnect.</p>
        ))}
    </div>
  )
}

function ApiChoice({
  api,
  canWrite,
  busy,
  onChange,
}: {
  api: UploadApi
  canWrite: boolean
  busy: boolean
  onChange: (api: UploadApi) => void
}) {
  const label = (a: UploadApi) => (a === 'data_manager' ? 'Data Manager API (recommended)' : 'Google Ads API')
  return (
    <div className="space-y-1">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3 text-xs" role="radiogroup" aria-label="Upload through">
          <span className="text-foreground-muted">Upload through</span>
          {(['data_manager', 'ads_api'] as const).map(a => (
            <label key={a} className="flex items-center gap-1.5">
              <input type="radio" name="upload-api" checked={api === a} disabled={busy} onChange={() => onChange(a)} />
              {label(a)}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-foreground-muted">Uploads through the {label(api)}.</p>
      )}
      {api === 'ads_api' && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Since 15 June 2026 Google only accepts Google Ads API click-conversion uploads from developer tokens that uploaded
          offline conversions before then; others are refused (CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE). Keep this only if the
          platform&apos;s token is one of them.
        </p>
      )}
    </div>
  )
}

function RequestsTable({ requests, error }: { requests: DataManagerRequest[] | null; error: string | null }) {
  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!requests) return <div className="h-16 rounded-lg bg-surface-secondary animate-pulse" />
  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground-muted">
        Google checks each upload after accepting it and reports per upload, not per order, from about 30 minutes later
        (up to a day). When every event of an upload is rejected, its orders are marked here and in the log; partly rejected
        uploads show the reasons below.
      </p>
      <Table<DataManagerRequest>
        rows={requests}
        rowKey={r => r.requestId}
        empty="Nothing sent through the Data Manager API yet."
        cols={[
          { key: 'sent', label: 'Sent', render: r => when(r.createdAt) },
          { key: 'kind', label: 'Kind', render: r => (r.kind === 'purchase' ? 'Purchases' : 'Adjustments') },
          { key: 'events', label: 'Events', num: true, render: r => count(r.events) },
          {
            key: 'status',
            label: 'Google',
            render: r => <Badge tone={REQUEST_LABEL[r.status]?.tone ?? 'muted'}>{REQUEST_LABEL[r.status]?.text ?? humanize(r.status)}</Badge>,
          },
          {
            key: 'detail',
            label: 'Detail',
            render: r => (
              <span className="text-xs">
                {r.errors.length > 0 && <span className="block text-red-600 dark:text-red-400">Rejected: {reasons(r.errors)}</span>}
                {r.warnings.length > 0 && <span className="block text-foreground-muted">Warnings: {reasons(r.warnings)}</span>}
                {r.fieldWarnings.length > 0 && (
                  <span className="block text-foreground-muted">
                    Fields ignored: {r.fieldWarnings.map(w => w.description || reasonLabel(w.reason)).join('; ')}
                  </span>
                )}
                {r.error && <span className="block text-foreground-muted">Status check: {r.error}</span>}
                {!r.errors.length && !r.warnings.length && !r.fieldWarnings.length && !r.error && (
                  <span className="text-foreground-muted">{r.status === 'PROCESSING' ? `Checked ${r.checks}x` : '-'}</span>
                )}
              </span>
            ),
          },
          { key: 'id', label: 'Request id', render: r => <span className="font-mono text-[11px] text-foreground-muted">{r.requestId}</span> },
        ]}
      />
    </div>
  )
}

/** Google's verdict on the request that sent an uploaded row. */
function googleVerdict(r: UploadRow): string | null {
  if (r.status !== 'uploaded' || !r.request_status) return null
  if (r.request_status === 'SUCCESS') return 'Confirmed by Google'
  if (r.request_status === 'PROCESSING') return `Sent ${when(r.uploaded_at)}; Google is processing it`
  if (r.request_status === 'PARTIAL_SUCCESS') {
    const rejected = (r.request_errors ?? []).reduce((n, c) => n + c.count, 0)
    return `Google rejected ${rejected} of ${r.request_events ?? '?'} events in this upload (${reasons(r.request_errors ?? [])}); which ones is not reported`
  }
  return `Sent ${when(r.uploaded_at)}; Google gave no status`
}

function EnhancedNote({ google }: { google: GoogleConversionsData | null }) {
  const s = google?.settings
  if (!s) return null
  const on = s.acceptedCustomerDataTerms === true && s.enhancedConversions === 'ON'
  return (
    <p className="text-xs text-foreground-secondary">
      {on
        ? 'Enhanced conversions are on: buyers who accepted advertising cookies are sent with their email and phone hashed (SHA-256); everyone else with the click id only (consent denied, or the account default when no choice was recorded).'
        : 'Only click ids are sent. To add hashed email and phone for buyers who accepted advertising cookies, turn on enhanced conversions for leads and accept the customer data terms in Google Ads (Goals > Settings).'}
      {s.conversionCustomer && s.trackingStatus === 'CONVERSION_TRACKING_MANAGED_BY_ANOTHER_MANAGER' && (
        <> Conversion actions for this account are managed in {formatCid(s.conversionCustomer)}.</>
      )}
    </p>
  )
}

function ActionsTable({
  actions,
  current,
  canWrite,
  busy,
  onUse,
  uploadable,
}: {
  actions: GoogleConversionAction[]
  current: string | null
  canWrite: boolean
  busy: string | null
  onUse: (a: GoogleConversionAction) => void
  uploadable: number
}) {
  const primaryPurchases = actions.filter(a => a.category === 'PURCHASE' && a.primaryForGoal && a.status === 'ENABLED')
  return (
    <div className="space-y-3">
      {primaryPurchases.length > 1 && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {primaryPurchases.length} purchase actions are primary ({primaryPurchases.map(a => a.name).join(', ')}), so each sale is
          counted {primaryPurchases.length} times for bidding. Make all but one secondary.
        </p>
      )}
      {!uploadable && (
        <p className="text-xs text-foreground-muted">No enabled import (UPLOAD_CLICKS) action yet; create one above.</p>
      )}
      <Table
        rows={actions}
        rowKey={a => a.resourceName}
        empty="No conversion actions in this account."
        cols={[
          {
            key: 'name',
            label: 'Action',
            render: a => (
              <span>
                {a.name}
                {a.resourceName === current && (
                  <span className="ml-2">
                    <Badge tone="green">Uploading here</Badge>
                  </span>
                )}
              </span>
            ),
            sort: a => a.name,
          },
          { key: 'type', label: 'Type', render: a => humanize(a.type) },
          { key: 'category', label: 'Category', render: a => humanize(a.category) },
          { key: 'counting', label: 'Counting', render: a => humanize(a.countingType) },
          {
            key: 'primary',
            label: 'Goal',
            render: a => (a.primaryForGoal == null ? '-' : a.primaryForGoal ? <Badge tone="green">Primary</Badge> : <Badge>Secondary</Badge>),
          },
          { key: 'status', label: 'Status', render: a => <Badge tone={a.status === 'ENABLED' ? 'green' : 'muted'}>{humanize(a.status)}</Badge> },
          {
            key: 'use',
            label: '',
            render: a =>
              canWrite && a.type === 'UPLOAD_CLICKS' && a.status === 'ENABLED' && a.resourceName !== current ? (
                <button
                  type="button"
                  onClick={() => onUse(a)}
                  disabled={busy === `use-${a.id}`}
                  className="text-xs text-accent-600 hover:underline disabled:opacity-60"
                >
                  Upload here
                </button>
              ) : null,
          },
        ]}
      />
    </div>
  )
}

function Diagnostics({ items, actionName }: { items: OfflineDiagnostics[] | null; actionName: string | null }) {
  if (!items) return <div className="h-16 rounded-lg bg-surface-secondary animate-pulse" />
  const shown = items.filter(i => i.scope === 'account' || !actionName || i.actionName === actionName)
  if (!shown.length) return <Empty msg="Google has no upload diagnostics yet. They cover the last full day of imports." />
  return (
    <div className="space-y-4">
      {shown.map((i, idx) => (
        <div key={`${i.scope}-${i.actionName ?? ''}-${i.client ?? ''}-${idx}`} className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{i.scope === 'account' ? 'Account' : i.actionName}</b>
            <span className="text-xs text-foreground-muted">{humanize(i.client)}</span>
            <Badge tone={i.status === 'EXCELLENT' || i.status === 'GOOD' ? 'green' : i.status === 'NEEDS_ATTENTION' ? 'red' : 'muted'}>
              {humanize(i.status)}
            </Badge>
          </div>
          <p className="text-xs text-foreground-secondary">
            {count(i.successful)} of {count(i.total)} accepted ({pct(i.successRate, 1)}), {count(i.pending)} pending. Last upload{' '}
            {i.lastUpload || '-'}.
          </p>
          {i.alerts.length > 0 && (
            <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
              {i.alerts.map(a => (
                <li key={a.error}>
                  {humanize(a.error)}
                  {a.percent != null ? `: ${pct(a.percent, 1)} of uploads` : ''}
                </li>
              ))}
            </ul>
          )}
          {i.daily.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px] text-foreground-muted">
              {i.daily.map(s => (
                <span key={s.key} className="rounded border border-border-default px-1.5 py-0.5">
                  {s.key}: {s.successful} ok, {s.failed} failed, {s.pending} pending
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { purchase: 'Purchase', retraction: 'Retraction', restatement: 'Restatement' }

function UploadLogSection({
  canWrite,
  currency,
  reloadKey,
  failedOverall,
  busy,
  onRetry,
}: {
  canWrite: boolean
  currency: string
  reloadKey: number
  failedOverall: number
  busy: string | null
  onRetry: (ids?: number[]) => void
}) {
  const [status, setStatus] = useState<UploadStatus | ''>('')
  const [page, setPage] = useState(1)
  const [log, setLog] = useState<UploadLog | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page) })
    if (status) qs.set('status', status)
    fetch(`/api/admin/google-ads/conversions?${qs}`, { credentials: 'include' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not load the upload log')
        setError(null)
        setLog(j)
      })
      .catch(e => setError(e.message))
  }, [status, page, reloadKey])

  const pages = log ? Math.max(1, Math.ceil(log.total / log.pageSize)) : 1
  return (
    <Section
      title="Upload log"
      action={
        canWrite && failedOverall > 0 ? (
          <IconButton icon={RotateCcw} label="Retry all failed" size="sm" busy={busy === 'retry'} onClick={() => onRetry()} />
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-1 mb-3">
        {(['', ...UPLOAD_STATUSES] as const).map(s => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => {
              setStatus(s)
              setPage(1)
            }}
            className={`control-xs border ${
              status === s ? 'border-accent-500 text-foreground font-medium' : 'border-border-default text-foreground-muted hover:text-foreground'
            }`}
          >
            {s ? humanize(s) : 'All'}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !log ? (
        <div className="h-24 rounded-lg bg-surface-secondary animate-pulse" />
      ) : (
        <>
          <Table<UploadRow>
            rows={log.rows}
            rowKey={r => String(r.id)}
            empty="Nothing queued yet. Orders from Google Ads clicks appear here once paid (COD: once delivered)."
            cols={[
              { key: 'created', label: 'Queued', render: r => when(r.created_at) },
              { key: 'order', label: 'Order', render: r => r.order_number },
              {
                key: 'kind',
                label: 'Kind',
                render: r => `${KIND_LABEL[r.kind] ?? r.kind}${r.kind === 'restatement' ? ` #${r.version}` : ''}`,
              },
              { key: 'value', label: 'Value', num: true, render: r => (r.kind === 'retraction' ? '-' : money(r.value, r.currency_code || currency, 2)) },
              { key: 'click', label: 'Click', render: r => r.click ?? '-' },
              {
                key: 'consent',
                label: 'Ads consent',
                render: r => (r.ads_consent == null ? '-' : r.ads_consent ? 'Yes' : 'No'),
              },
              {
                key: 'status',
                label: 'Status',
                render: r => (
                  <span className="whitespace-nowrap">
                    <Badge tone={STATUS_TONE[r.status]}>{humanize(r.status)}</Badge>
                    {r.attempts > 0 && <span className="ml-1 text-[11px] text-foreground-muted">x{r.attempts}</span>}
                  </span>
                ),
              },
              {
                key: 'detail',
                label: 'Detail',
                render: r => (
                  <span className={`text-xs ${r.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
                    {r.error ||
                      googleVerdict(r) ||
                      (r.status === 'uploaded'
                        ? `Uploaded ${when(r.uploaded_at)}`
                        : r.status === 'pending'
                          ? `Next try ${when(r.next_attempt_at)}`
                          : '-')}
                  </span>
                ),
              },
              {
                key: 'retry',
                label: '',
                render: r =>
                  canWrite && r.status === 'failed' ? (
                    <IconButton icon={RefreshCw} label="Retry" size="sm" busy={busy === `retry-${r.id}`} onClick={() => onRetry([r.id])} />
                  ) : null,
              },
            ]}
          />
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-3 text-xs text-foreground-muted">
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">
                Previous
              </button>
              <span>
                Page {page} of {pages} ({count(log.total)})
              </span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  )
}
