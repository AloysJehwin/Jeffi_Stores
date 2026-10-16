'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, Unplug } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import { ChangeHistory, ChannelAlerts, JobRuns } from '@/components/admin/channels/ChannelPanels'
import {
  Badge,
  Banner,
  Empty,
  Kpi,
  KpiGrid,
  RangePresets,
  Section,
  Table,
  Tabs,
  api,
  btnGhost,
  btnPrimary,
  change,
  count,
  inputCls,
  lastDays,
  money,
  pct,
} from '@/components/admin/channels/ui'
import type { AadsTab } from '@/lib/amazon-ads/console'

const TABS: { id: AadsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'searchterms', label: 'Search terms' },
  { id: 'products', label: 'Products' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]
const DATA_TABS = new Set<AadsTab>(['overview', 'campaigns', 'keywords', 'searchterms', 'products'])
const ACTIONS = '/api/admin/amazon-ads/console/actions'
const ALERT_PARAMS = {
  maxAcos: 'max ACoS %',
  minSpend: 'minimum spend',
  days: 'days',
  minClicks: 'minimum clicks',
  hours: 'hours',
}

const SERIES: SeriesDef[] = [
  { key: 'cost', label: 'Spend', color: 'rgb(239 68 68)', kind: 'line', axis: 'money', on: true },
  { key: 'sales', label: 'Ad sales', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
  { key: 'clicks', label: 'Clicks', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
]

const ERRORS: Record<string, string> = {
  not_configured: 'Amazon Ads sign-in is not configured on this platform (AMAZON_ADS_CLIENT_ID / SECRET).',
  bad_state: 'The sign-in link expired. Try again.',
  missing_params: 'Amazon returned without a code. Try again.',
}

export default function AmazonAdsConsole() {
  const router = useRouter()
  const sp = useSearchParams()
  const tabParam = sp.get('tab') as AadsTab | null
  const [tab, setTabState] = useState<AadsTab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [status, setStatus] = useState<any>(null)
  const [range, setRange] = useState(() => lastDays(30, 1))
  const [loaded, setLoaded] = useState<{ tab: string; data: any } | null>(null)
  const data = loaded?.tab === tab ? loaded.data : null
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const canWrite = useCanWrite('amazon_ads')

  const loadStatus = useCallback(async () => {
    const r = await api('/api/admin/amazon-ads/connection')
    if (r.ok) setStatus(r.data)
    else setError(r.data.error || 'Could not load')
  }, [])
  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const c = sp.get('connected')
    if (!c) return
    if (c === '0')
      setBanner({
        ok: false,
        text: ERRORS[sp.get('error') ?? ''] || decodeURIComponent(sp.get('error') ?? 'Sign-in failed'),
      })
    else setBanner({ ok: true, text: 'Signed in with Amazon. Choose the advertising profile below.' })
    const url = new URL(window.location.href)
    ;['connected', 'error', 'pick'].forEach(k => url.searchParams.delete(k))
    window.history.replaceState(null, '', url.toString())
  }, [sp])

  useEffect(() => {
    if (!status?.connected || !DATA_TABS.has(tab)) return
    setError(null)
    api(`/api/admin/amazon-ads/console?${new URLSearchParams({ tab, ...range })}`).then(r =>
      r.ok ? setLoaded({ tab, data: r.data.data }) : setError(r.data.error || 'Failed to load')
    )
  }, [tab, range, status?.connected, reloadKey])

  function setTab(next: AadsTab) {
    setTabState(next)
    const params = new URLSearchParams(sp.toString())
    params.set('tab', next)
    router.push(`${ap('/admin/amazon-ads')}?${params.toString()}`, { scroll: false })
  }

  async function sync() {
    setBusy('sync')
    setBanner(null)
    const r = await api('/api/admin/amazon-ads/console/sync', { method: 'POST' })
    setBusy(null)
    setBanner(
      !r.ok
        ? { ok: false, text: r.data.error || 'Sync failed' }
        : {
            ok: r.data.status !== 'error',
            text:
              r.data.status === 'success'
                ? 'Synced campaigns. Reports are requested now and arrive with the next sync (Amazon builds them in a few minutes).'
                : `Synced with problems: ${(r.data.errors ?? []).map((e: any) => `${e.step}: ${e.message}`).join('; ')}`,
          }
    )
    reload()
  }

  if (!status) return <p className="text-sm text-foreground-muted">{error ?? 'Loading...'}</p>
  if (!status.envReady)
    return (
      <Banner ok={false}>
        Amazon Ads is not set up on this platform yet: it needs the Amazon Ads API app (AMAZON_ADS_CLIENT_ID and
        AMAZON_ADS_CLIENT_SECRET), which Amazon approves separately from Seller Central.
      </Banner>
    )

  return (
    <div className="space-y-4">
      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      {!status.connected ? (
        <ConnectPanel
          status={status}
          canWrite={canWrite}
          onChanged={() => {
            loadStatus()
            reload()
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <RangePresets value={range} onChange={setRange} endOffset={1} />
              <span className="text-xs text-foreground-muted">
                {status.profileName} ({status.countryCode}) ·{' '}
                {status.connectedVia === 'manual' ? 'entered manually' : 'Amazon sign-in'}
              </span>
            </div>
            {canWrite && (
              <div className="flex gap-1">
                <IconButton icon={RefreshCw} label="Sync now" busy={busy === 'sync'} onClick={sync} />
                <IconButton
                  icon={Unplug}
                  label="Disconnect"
                  variant="danger"
                  onClick={async () => {
                    await api('/api/admin/amazon-ads/connection', { method: 'DELETE' })
                    setBanner({ ok: true, text: 'Amazon Ads disconnected. Synced data is kept.' })
                    loadStatus()
                  }}
                />
              </div>
            )}
          </div>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : DATA_TABS.has(tab) && !data ? (
            <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
          ) : (
            <Body tab={tab} d={data} onChanged={reload} />
          )}
        </>
      )}
    </div>
  )
}

function ConnectPanel({ status, canWrite, onChanged }: { status: any; canWrite: boolean; onChanged: () => void }) {
  const [manual, setManual] = useState({ refreshToken: '', profileId: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const choose = async (body: Record<string, string>) => {
    setMsg(null)
    const r = await api('/api/admin/amazon-ads/connection', { method: 'POST', json: body })
    if (r.ok) onChanged()
    else setMsg(r.data.error || 'Could not connect')
  }
  if (!canWrite)
    return (
      <p className="text-sm text-foreground-muted">
        Amazon Ads is not connected yet. An admin with Amazon Ads write access can connect it.
      </p>
    )
  return (
    <Section title="Connect Amazon Ads">
      {status.pending ? (
        <div className="space-y-2">
          <p className="text-sm">Choose the advertising profile for this store:</p>
          {status.profileError && <p className="text-sm text-red-500">{status.profileError}</p>}
          {!status.profiles.length && !status.profileError && (
            <p className="text-sm text-foreground-muted">
              This Amazon sign-in has no advertising profiles. Sign in with the account that runs your Sponsored
              Products.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {status.profiles.map((p: any) => (
              <button
                key={p.profileId}
                type="button"
                className={`${btnGhost} justify-between`}
                onClick={() => choose({ profileId: p.profileId })}
              >
                <span>
                  {p.name}{' '}
                  <span className="text-xs text-foreground-muted">
                    ({p.countryCode}, {p.type})
                  </span>
                </span>
                <span className="text-xs text-foreground-muted">{p.profileId}</span>
              </button>
            ))}
          </div>
          <a className="text-xs underline" href="/api/admin/integrations/amazon-ads/connect">
            Sign in with a different Amazon account
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {status.oauth?.enabled ? (
            <a className={btnPrimary} href="/api/admin/integrations/amazon-ads/connect">
              Connect with Amazon
            </a>
          ) : (
            <p className="text-xs text-foreground-muted">
              Sign-in with Amazon needs {status.oauth?.missing?.join(', ')}; you can still enter a refresh token below.
            </p>
          )}
          <div className="grid gap-2 md:grid-cols-3 items-end">
            <label className="text-xs text-foreground-muted md:col-span-2">
              Or enter a refresh token (from the Amazon Ads API app)
              <input
                className={inputCls}
                type="password"
                value={manual.refreshToken}
                onChange={e => setManual(m => ({ ...m, refreshToken: e.target.value }))}
              />
            </label>
            <label className="text-xs text-foreground-muted">
              Profile id
              <input
                className={inputCls}
                value={manual.profileId}
                onChange={e => setManual(m => ({ ...m, profileId: e.target.value.trim() }))}
              />
            </label>
          </div>
          <button
            type="button"
            className={btnPrimary}
            disabled={!manual.refreshToken || !manual.profileId}
            onClick={() => choose(manual)}
          >
            Connect
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-red-500 mt-2">{msg}</p>}
    </Section>
  )
}

const stateTone = (s: string) => (s === 'ENABLED' ? 'green' : s === 'PAUSED' ? 'amber' : 'muted')
const kpiCols = [
  { key: 'cost', label: 'Spend', num: true, render: (r: any) => money(r.cost), sort: (r: any) => r.cost },
  { key: 'sales', label: 'Sales', num: true, render: (r: any) => money(r.sales), sort: (r: any) => r.sales },
  { key: 'acos', label: 'ACoS', num: true, render: (r: any) => pct(r.acos), sort: (r: any) => r.acos ?? 999 },
  { key: 'clicks', label: 'Clicks', num: true, render: (r: any) => count(r.clicks), sort: (r: any) => r.clicks },
  { key: 'cpc', label: 'CPC', num: true, render: (r: any) => money(r.cpc, 2), sort: (r: any) => r.cpc ?? 0 },
  { key: 'orders', label: 'Orders', num: true, render: (r: any) => count(r.orders), sort: (r: any) => r.orders },
]

function Body({ tab, d, onChanged }: { tab: AadsTab; d: any; onChanged: () => void }) {
  const canWrite = useCanWrite('amazon_ads')
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const ask = (p: Record<string, unknown>) => setPending(p)
  const prompt = (label: string, current: number | null, make: (v: number) => Record<string, unknown>) => (
    <NumberEdit label={label} current={current} onSubmit={v => ask(make(v))} />
  )
  const dialog = pending && (
    <PreviewApply
      writeScope="amazon_ads:write"
      endpoint={ACTIONS}
      payload={pending}
      onClose={() => setPending(null)}
      onDone={onChanged}
    />
  )
  switch (tab) {
    case 'overview': {
      const k = d.kpis
      const p = d.previous
      return (
        <div className="space-y-5">
          <KpiGrid>
            <Kpi label="Spend" value={money(k.cost)} delta={change(k.cost, p.cost)} invert />
            <Kpi label="Ad sales" value={money(k.sales)} delta={change(k.sales, p.sales)} />
            <Kpi label="ACoS" value={pct(k.acos)} sub="spend / ad sales" highlight />
            <Kpi
              label="TACoS"
              value={pct(d.tacos)}
              sub={d.tacos == null ? 'needs the Amazon sales report' : `of ${money(d.totalSales)} total Amazon sales`}
            />
            <Kpi label="ROAS" value={k.roas == null ? '-' : `${k.roas.toFixed(2)}x`} />
            <Kpi label="Orders" value={count(k.orders)} sub={`${count(k.clicks)} clicks, CPC ${money(k.cpc, 2)}`} />
          </KpiGrid>
          <Section title="By day">
            {d.daily.length ? (
              <TrendChart
                points={d.daily.map((x: any) => ({ label: x.date, cost: x.cost, sales: x.sales, clicks: x.clicks }))}
                series={SERIES}
                ariaLabel="Amazon Ads spend and sales by day"
              />
            ) : (
              <Empty msg="No report data yet. Reports arrive with the sync after they are requested." />
            )}
          </Section>
        </div>
      )
    }
    case 'campaigns':
      return (
        <Section title="Campaigns">
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.campaignId}
            empty="No campaigns. Sync first."
            cols={[
              { key: 'name', label: 'Campaign', render: (r: any) => r.name },
              { key: 'state', label: 'State', render: (r: any) => <Badge tone={stateTone(r.state)}>{r.state}</Badge> },
              { key: 'type', label: 'Targeting', render: (r: any) => r.targeting ?? '-' },
              {
                key: 'budget',
                label: 'Daily budget',
                num: true,
                render: (r: any) =>
                  canWrite
                    ? prompt('budget', r.budget, v => ({
                        action: 'campaign.budget',
                        campaignId: r.campaignId,
                        budget: v,
                      }))
                    : money(r.budget),
              },
              ...kpiCols,
              ...(canWrite
                ? [
                    {
                      key: 'act',
                      label: '',
                      render: (r: any) => (
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() =>
                            ask({
                              action: 'campaign.state',
                              campaignId: r.campaignId,
                              state: r.state === 'ENABLED' ? 'PAUSED' : 'ENABLED',
                            })
                          }
                        >
                          {r.state === 'ENABLED' ? 'Pause' : 'Enable'}
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {dialog}
        </Section>
      )
    case 'keywords':
      return (
        <Section title="Keywords">
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.keywordId}
            empty="No keywords. Sync first."
            cols={[
              {
                key: 'text',
                label: 'Keyword',
                render: (r: any) => (
                  <span>
                    {r.text} {r.negative && <Badge tone="red">negative</Badge>}
                  </span>
                ),
              },
              { key: 'match', label: 'Match', render: (r: any) => r.matchType.toLowerCase().replace('negative_', '') },
              {
                key: 'where',
                label: 'Campaign / ad group',
                render: (r: any) => (
                  <span className="text-xs">
                    {r.campaign} / {r.adGroup}
                  </span>
                ),
              },
              { key: 'state', label: 'State', render: (r: any) => <Badge tone={stateTone(r.state)}>{r.state}</Badge> },
              {
                key: 'bid',
                label: 'Bid',
                num: true,
                render: (r: any) =>
                  r.negative
                    ? '-'
                    : canWrite
                      ? prompt('bid', r.bid, v => ({ action: 'keyword.bid', keywordId: r.keywordId, bid: v }))
                      : money(r.bid, 2),
              },
              ...kpiCols,
              ...(canWrite
                ? [
                    {
                      key: 'act',
                      label: '',
                      render: (r: any) =>
                        r.negative ? null : (
                          <button
                            type="button"
                            className="text-xs underline"
                            onClick={() =>
                              ask({
                                action: 'keyword.state',
                                keywordId: r.keywordId,
                                state: r.state === 'ENABLED' ? 'PAUSED' : 'ENABLED',
                              })
                            }
                          >
                            {r.state === 'ENABLED' ? 'Pause' : 'Enable'}
                          </button>
                        ),
                    },
                  ]
                : []),
            ]}
          />
          {dialog}
        </Section>
      )
    case 'searchterms':
      return (
        <Section title="Search terms">
          <p className="text-xs text-foreground-muted mb-3">
            What shoppers typed. Terms with {d.harvest}+ orders that are not yet an exact keyword can be added as one;
            terms with {d.waste}+ clicks and no orders can be added as negatives.
          </p>
          <Table
            rows={d.rows}
            rowKey={(r: any) => `${r.adGroupId}:${r.term}`}
            empty="No search terms in this range."
            cols={[
              { key: 'term', label: 'Search term', render: (r: any) => r.term },
              {
                key: 'where',
                label: 'Campaign / ad group',
                render: (r: any) => (
                  <span className="text-xs">
                    {r.campaign} / {r.adGroup}
                  </span>
                ),
              },
              ...kpiCols,
              {
                key: 'do',
                label: '',
                render: (r: any) =>
                  !canWrite || !r.suggestion ? (
                    r.isNegative ? (
                      <Badge>negative</Badge>
                    ) : r.isExact ? (
                      <Badge tone="green">exact keyword</Badge>
                    ) : null
                  ) : r.suggestion === 'harvest' ? (
                    <button
                      type="button"
                      className="text-xs text-accent-500 underline"
                      onClick={() =>
                        ask({
                          action: 'keyword.add',
                          campaignId: r.campaignId,
                          adGroupId: r.adGroupId,
                          text: r.term,
                          matchType: 'EXACT',
                          bid: Math.max(1, Math.round((r.cpc ?? 5) * 100) / 100),
                        })
                      }
                    >
                      Add as exact
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-red-500 underline"
                      onClick={() =>
                        ask({
                          action: 'negative.add',
                          campaignId: r.campaignId,
                          adGroupId: r.adGroupId,
                          text: r.term,
                          matchType: 'NEGATIVE_EXACT',
                        })
                      }
                    >
                      Add negative
                    </button>
                  ),
              },
            ]}
          />
          {dialog}
        </Section>
      )
    case 'products':
      return (
        <Section title="Advertised products">
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.sku}
            empty="No product data in this range."
            cols={[
              { key: 'name', label: 'Product', render: (r: any) => r.name ?? r.sku },
              {
                key: 'stock',
                label: 'Stock',
                render: (r: any) =>
                  r.stockStatus ? (
                    <Badge tone={/out/i.test(r.stockStatus) ? 'red' : 'green'}>{r.stockStatus}</Badge>
                  ) : (
                    '-'
                  ),
              },
              ...kpiCols,
              {
                key: 'units',
                label: 'Units',
                num: true,
                render: (r: any) => count(r.units),
                sort: (r: any) => r.units,
              },
              {
                key: 'profit',
                label: 'Profit after ads',
                num: true,
                render: (r: any) =>
                  r.profitAfterAds == null ? (
                    <span className="text-xs text-foreground-muted">no cost price</span>
                  ) : (
                    <span className={r.profitAfterAds < 0 ? 'text-red-500' : ''}>{money(r.profitAfterAds)}</span>
                  ),
                sort: (r: any) => r.profitAfterAds ?? -1e12,
              },
            ]}
          />
        </Section>
      )
    case 'alerts':
      return <ChannelAlerts channel="amazon_ads" params={ALERT_PARAMS} />
    case 'changes':
      return <ChangeHistory channel="amazon_ads" />
    case 'runs':
      return <JobRuns channel="amazon_ads" />
  }
}

function NumberEdit({
  label,
  current,
  onSubmit,
}: {
  label: string
  current: number | null
  onSubmit: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(String(current ?? ''))
  if (!editing)
    return (
      <button
        type="button"
        className="underline decoration-dotted"
        title={`Change ${label}`}
        onClick={() => setEditing(true)}
      >
        {money(current, 2)}
      </button>
    )
  return (
    <span className="inline-flex gap-1">
      <input
        className={`${inputCls} w-24 py-1`}
        type="number"
        min={0}
        value={v}
        aria-label={label}
        onChange={e => setV(e.target.value)}
      />
      <button
        type="button"
        className="text-xs underline"
        onClick={() => {
          setEditing(false)
          if (Number(v) > 0) onSubmit(Number(v))
        }}
      >
        Preview
      </button>
    </span>
  )
}
