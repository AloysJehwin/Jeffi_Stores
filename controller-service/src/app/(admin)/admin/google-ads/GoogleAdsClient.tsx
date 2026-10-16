'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeftRight, CheckCircle2, PlugZap, RefreshCw, Unplug } from 'lucide-react'
import { btnGhost } from '@/components/admin/channels/ui'
import IconButton from '@/components/ui/IconButton'
import ConnectionsGear, { NotConnectedState, type ConnectionState } from '@/components/admin/ConnectionsGear'
import DatePicker from '@/components/ui/DatePicker'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { formatCid } from '@/lib/google-ads/format'
import type { AdsConnectionStatus } from '@/lib/google-ads/connection'
import type { AdsTab } from '@/lib/google-ads/report'
import { AdsManageProvider } from './_components/ManageContext'
import { NewCampaignButton } from './_components/CampaignWizard'
import ConnectPanel, { NotConfigured } from './_components/ConnectPanel'
import ConversionsView from './_components/ConversionsView'
import ExperimentsView from './_components/ExperimentsView'
import AudiencesView from './_components/AudiencesView'
import {
  OverviewView,
  CampaignsView,
  AdGroupsView,
  KeywordsView,
  ProductsView,
  LocationsView,
  RecommendationsView,
  ChangesView,
  SyncView,
} from './_components/ReportViews'

const TABS: { id: AdsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adgroups', label: 'Ad groups & ads' },
  { id: 'keywords', label: 'Keywords & search terms' },
  { id: 'products', label: 'Products' },
  { id: 'locations', label: 'Locations' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'changes', label: 'Change history' },
  { id: 'conversions', label: 'Conversions' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'audiences', label: 'Audiences' },
  { id: 'sync', label: 'Sync status' },
]

const PRESETS = [7, 14, 30, 90]

const VIA_LABEL: Record<string, string> = {
  oauth: 'Google sign-in',
  manual: 'entered manually',
  manager: 'managed by the platform',
  platform: 'platform service account',
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
function lastDays(n: number) {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - (n - 1))
  return { from: iso(from), to: iso(to) }
}

const ERRORS: Record<string, string> = {
  not_configured: 'Google Ads sign-in is not configured on this platform.',
  bad_state: 'The sign-in link expired or was tampered with. Try again.',
  scope_not_granted: 'Google Ads access was not granted. Allow it on the Google consent screen.',
  access_denied: 'Sign-in was cancelled.',
  missing_params: 'Google returned without a code. Try again.',
}

export default function GoogleAdsClient({
  initialStatus,
  currency,
  hasData,
}: {
  initialStatus: AdsConnectionStatus
  currency: string
  hasData: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as AdsTab | null
  const [tab, setTabState] = useState<AdsTab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [status, setStatus] = useState(initialStatus)
  const [range, setRange] = useState(() => lastDays(30))
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'sync' | 'test' | 'disconnect' | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [gearOpen, setGearOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  // OAuth return (?connected=...) shows once, then the URL is cleaned.
  useEffect(() => {
    const connected = searchParams.get('connected')
    if (!connected) return
    if (connected === '0') {
      const err = searchParams.get('error') || 'exchange_failed'
      setBanner({ ok: false, text: ERRORS[err] || decodeURIComponent(err) })
    } else if (searchParams.get('pick')) {
      setBanner({ ok: true, text: 'Signed in with Google. Now choose the account in the gear (top right).' })
    }
    if (connected === '0' || searchParams.get('pick')) setGearOpen(true)
    const url = new URL(window.location.href)
    ;['connected', 'provider', 'error', 'pick'].forEach(k => url.searchParams.delete(k))
    window.history.replaceState(null, '', url.toString())
  }, [searchParams])

  const refreshStatus = useCallback(async () => {
    const r = await fetch('/api/admin/google-ads/connection', { credentials: 'include' })
    if (r.ok) setStatus(await r.json())
  }, [])

  const connected = status.connected
  useEffect(() => {
    if (!connected) return
    setLoading(true)
    setLoadError(null)
    const qs = new URLSearchParams({ tab, from: range.from, to: range.to })
    fetch(`/api/admin/google-ads/report?${qs}`, { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Failed to load')
        setData(d.data)
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [tab, range, connected, reloadKey])

  function setTab(next: AdsTab) {
    setData(null)
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.push(`${ap('/admin/google-ads')}?${params.toString()}`, { scroll: false })
  }

  async function action(kind: 'sync' | 'test' | 'disconnect') {
    setBusy(kind)
    setBanner(null)
    try {
      if (kind === 'test') {
        const r = await fetch('/api/admin/google-ads/test', { credentials: 'include' })
        const d = await r.json().catch(() => ({}))
        setBanner({ ok: !!d.ok, text: d.message || d.error || 'Test failed' })
      } else if (kind === 'sync') {
        const r = await fetch('/api/admin/google-ads/sync', { method: 'POST', credentials: 'include' })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) setBanner({ ok: false, text: d.error || 'Sync failed' })
        else
          setBanner({
            ok: d.status !== 'error',
            text:
              d.status === 'success'
                ? 'Synced the last 30 days from Google Ads.'
                : `Sync ${d.status}: ${(d.errors ?? []).map((e: any) => `${e.step}: ${e.message}`).join('; ')}`,
          })
      } else {
        const r = await fetch('/api/admin/google-ads/connection', { method: 'DELETE', credentials: 'include' })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) setBanner({ ok: false, text: d.error || 'Could not disconnect' })
        else {
          setBanner({ ok: true, text: 'Google Ads disconnected. Synced reports are kept.' })
          await refreshStatus()
        }
        setConfirmDisconnect(false)
      }
    } finally {
      setBusy(null)
      if (kind === 'sync') setReloadKey(k => k + 1)
    }
  }

  const envReady = status.env.developerToken
  const canWrite = useCanWrite('google_ads')

  const state: ConnectionState = connected ? 'connected' : status.pendingAccount ? 'pending' : 'none'
  const bannerEl = banner && (
    <div
      className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
        banner.ok ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'
      }`}
    >
      {banner.ok ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 mt-0.5 text-red-500 shrink-0" />
      )}
      <span>{banner.text}</span>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Google Ads</h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            {connected
              ? `${status.accountName || 'Account'} ${formatCid(status.customerId)}${
                  status.loginCustomerId ? ` · via manager ${formatCid(status.loginCustomerId)}` : ''
                } · ${VIA_LABEL[status.connectedVia ?? 'oauth']}`
              : 'Reporting and campaigns for your Google Ads account'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {connected && <NewCampaignButton onCreated={reload} />}
          {connected && canWrite && (
            <IconButton icon={RefreshCw} label="Sync now (last 30 days)" busy={busy === 'sync'} onClick={() => action('sync')} />
          )}
          <ConnectionsGear
            title="Google Ads connection"
            scope="google_ads"
            state={state}
            open={gearOpen}
            onOpenChange={setGearOpen}
          >
            {bannerEl}
            {!envReady && <NotConfigured status={status} />}
            {connected && (
              <div className="rounded-xl border border-border-default p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {status.accountName || 'Account'} <span className="text-foreground-muted">{formatCid(status.customerId)}</span>
                </p>
                <p className="text-xs text-foreground-muted">
                  {status.loginCustomerId ? `Via manager ${formatCid(status.loginCustomerId)} · ` : ''}
                  {VIA_LABEL[status.connectedVia ?? 'oauth']}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={btnGhost} disabled={busy === 'test'} onClick={() => action('test')}>
                    <PlugZap className="w-4 h-4" /> Test connection
                  </button>
                  {canWrite && (
                    <button type="button" className={btnGhost} onClick={() => setShowConnect(s => !s)}>
                      <ArrowLeftRight className="w-4 h-4" /> Change account
                    </button>
                  )}
                  {canWrite && status.connectedVia !== 'platform' && (
                    <button
                      type="button"
                      className={`${btnGhost} text-red-600`}
                      disabled={busy === 'disconnect'}
                      onClick={() => setConfirmDisconnect(true)}
                    >
                      <Unplug className="w-4 h-4" /> Disconnect
                    </button>
                  )}
                </div>
                {confirmDisconnect && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
                    <span>Disconnect Google Ads? Syncing stops; reports already synced stay.</span>
                    <button type="button" onClick={() => action('disconnect')} className="rounded-md bg-red-600 px-3 py-1.5 text-white text-xs">
                      Disconnect
                    </button>
                    <button type="button" onClick={() => setConfirmDisconnect(false)} className="text-xs text-foreground-muted">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
            {canWrite && (!connected || showConnect || status.pendingAccount) && (
              <ConnectPanel
                status={status}
                onChanged={s => {
                  if (s) setStatus(s)
                  else refreshStatus()
                  setShowConnect(false)
                  setBanner({ ok: true, text: 'Google Ads connected. Run Sync now to pull the last 30 days.' })
                }}
              />
            )}
            {!canWrite && !connected && (
              <p className="text-sm text-foreground-muted">
                Google Ads is not connected yet. An admin with Google Ads write access can connect it.
              </p>
            )}
          </ConnectionsGear>
        </div>
      </div>

      {bannerEl}

      {!connected && <NotConnectedState provider="Google Ads" onOpen={() => setGearOpen(true)} />}

      {connected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
              {PRESETS.map(n => {
                const r = lastDays(n)
                const active = r.from === range.from && r.to === range.to
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md ${active ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
                  >
                    {n}d
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <DatePicker value={range.from} max={range.to} onChange={v => v && setRange(r => ({ ...r, from: v }))} />
              to
              <DatePicker value={range.to} min={range.from} onChange={v => v && setRange(r => ({ ...r, to: v }))} />
            </div>
          </div>

          {!hasData && !data && (
            <p className="text-sm text-foreground-muted">No data synced yet. Use Sync now (top right) to pull the last 30 days.</p>
          )}

          <div className="flex gap-0.5 border-b border-border-default overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${
                  tab === t.id ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loadError ? (
            <p className="text-sm text-red-500">{loadError}</p>
          ) : loading && !data ? (
            <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
          ) : data ? (
            <AdsManageProvider currency={currency} onChanged={reload}>
              <TabBody tab={tab} data={data} currency={currency} />
            </AdsManageProvider>
          ) : null}
        </>
      )}
    </div>
  )
}

function TabBody({ tab, data, currency }: { tab: AdsTab; data: any; currency: string }) {
  switch (tab) {
    case 'overview':
      return data.kpis ? <OverviewView d={data} currency={currency} /> : null
    case 'campaigns':
      return <CampaignsView rows={data.campaigns ?? []} currency={currency} />
    case 'adgroups':
      return <AdGroupsView d={{ adGroups: data.adGroups ?? [], ads: data.ads ?? [] }} currency={currency} />
    case 'keywords':
      return <KeywordsView d={{ keywords: data.keywords ?? [], searchTerms: data.searchTerms ?? [] }} currency={currency} />
    case 'products':
      return <ProductsView d={{ items: data.items ?? [], bestsellersWithoutImpressions: data.bestsellersWithoutImpressions ?? [] }} currency={currency} />
    case 'locations':
      return <LocationsView rows={data.locations ?? []} currency={currency} />
    case 'recommendations':
      return <RecommendationsView rows={data.recommendations ?? []} currency={currency} />
    case 'changes':
      return <ChangesView rows={data.changes ?? []} />
    case 'conversions':
      return <ConversionsView d={data} currency={currency} />
    case 'experiments':
      return <ExperimentsView d={data} currency={currency} />
    case 'audiences':
      return <AudiencesView d={data} />
    case 'sync':
      return <SyncView rows={data.log ?? []} />
  }
}
