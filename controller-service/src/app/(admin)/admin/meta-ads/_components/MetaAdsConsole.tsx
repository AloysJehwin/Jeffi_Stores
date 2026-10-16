'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, Send, Unplug } from 'lucide-react'
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
  when,
} from '@/components/admin/channels/ui'
import type { MadsTab } from '@/lib/meta-ads/console'

const TABS: { id: MadsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'adsets', label: 'Ad sets' },
  { id: 'ads', label: 'Ads' },
  { id: 'breakdowns', label: 'Audience & placement' },
  { id: 'capi', label: 'Conversions API' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]
const DATA_TABS = new Set<MadsTab>(['overview', 'campaigns', 'adsets', 'ads', 'breakdowns', 'capi'])
const ACTIONS = '/api/admin/meta-ads/console/actions'
const ALERT_PARAMS = { minRoas: 'min ROAS', minSpend: 'minimum spend', days: 'days' }
const SERIES: SeriesDef[] = [
  { key: 'spend', label: 'Spend', color: 'rgb(239 68 68)', kind: 'line', axis: 'money', on: true },
  { key: 'value', label: 'Purchase value', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
  { key: 'linkClicks', label: 'Link clicks', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
]
const ERRORS: Record<string, string> = {
  not_configured: 'Facebook sign-in is not configured on this platform (META_APP_ID / META_APP_SECRET).',
  bad_state: 'The sign-in link expired. Try again.',
}

export default function MetaAdsConsole() {
  const router = useRouter()
  const sp = useSearchParams()
  const tabParam = sp.get('tab') as MadsTab | null
  const [tab, setTabState] = useState<MadsTab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [status, setStatus] = useState<any>(null)
  const [range, setRange] = useState(() => lastDays(30))
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const canWrite = useCanWrite('meta_ads')

  const loadStatus = useCallback(async () => {
    const r = await api('/api/admin/meta-ads/connection')
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
    else setBanner({ ok: true, text: 'Signed in with Facebook. Choose the ad account below.' })
    const url = new URL(window.location.href)
    ;['connected', 'error', 'pick'].forEach(k => url.searchParams.delete(k))
    window.history.replaceState(null, '', url.toString())
  }, [sp])

  useEffect(() => {
    if (!status?.connected || !DATA_TABS.has(tab)) return
    setData(null)
    setError(null)
    api(`/api/admin/meta-ads/console?${new URLSearchParams({ tab, ...range })}`).then(r =>
      r.ok ? setData(r.data.data) : setError(r.data.error || 'Failed to load')
    )
  }, [tab, range, status?.connected, reloadKey])

  function setTab(next: MadsTab) {
    setTabState(next)
    const params = new URLSearchParams(sp.toString())
    params.set('tab', next)
    router.push(`${ap('/admin/meta-ads')}?${params.toString()}`, { scroll: false })
  }

  async function run(kind: 'sync' | 'capi') {
    setBusy(kind)
    setBanner(null)
    const r = await api('/api/admin/meta-ads/console/sync', { method: 'POST', json: { kind } })
    setBusy(null)
    setBanner(
      !r.ok
        ? { ok: false, text: r.data.error || 'Failed' }
        : {
            ok: r.data.status !== 'error',
            text:
              r.data.status === 'success'
                ? kind === 'capi'
                  ? `Sent ${r.data.counts?.sent ?? 0} purchases to Meta.`
                  : 'Synced the last 30 days from Meta.'
                : `Finished with problems: ${(r.data.errors ?? []).map((e: any) => `${e.step}: ${e.message}`).join('; ')}`,
          }
    )
    reload()
  }

  if (!status) return <p className="text-sm text-foreground-muted">{error ?? 'Loading...'}</p>
  if (!status.envReady)
    return (
      <Banner ok={false}>
        Meta Ads needs the platform&apos;s Meta app (META_APP_ID and META_APP_SECRET) with ads permissions approved by
        Meta.
      </Banner>
    )

  return (
    <div className="space-y-4">
      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      {!status.connected ? (
        <ConnectPanel status={status} canWrite={canWrite} onChanged={loadStatus} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <RangePresets value={range} onChange={setRange} />
              <span className="text-xs text-foreground-muted">
                {status.adAccountName} ({status.adAccountId})
                {status.tokenExpiresAt ? ` · sign-in valid until ${when(status.tokenExpiresAt)}` : ''}
              </span>
            </div>
            {canWrite && (
              <div className="flex gap-1">
                <IconButton icon={RefreshCw} label="Sync now" busy={busy === 'sync'} onClick={() => run('sync')} />
                <IconButton
                  icon={Send}
                  label="Send purchases to Meta now"
                  busy={busy === 'capi'}
                  onClick={() => run('capi')}
                />
                <IconButton
                  icon={Unplug}
                  label="Disconnect"
                  variant="danger"
                  onClick={async () => {
                    await api('/api/admin/meta-ads/connection', { method: 'DELETE' })
                    setBanner({ ok: true, text: 'Meta Ads disconnected. Synced data is kept.' })
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
            <Body
              tab={tab}
              d={data}
              status={status}
              onChanged={() => {
                reload()
                loadStatus()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

function ConnectPanel({ status, canWrite, onChanged }: { status: any; canWrite: boolean; onChanged: () => void }) {
  const [manual, setManual] = useState({ accessToken: '', adAccountId: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const post = async (body: Record<string, string>) => {
    setMsg(null)
    const r = await api('/api/admin/meta-ads/connection', { method: 'POST', json: body })
    if (r.ok) onChanged()
    else setMsg(r.data.error || 'Could not connect')
  }
  if (!canWrite)
    return (
      <p className="text-sm text-foreground-muted">
        Meta Ads is not connected yet. An admin with Meta Ads write access can connect it.
      </p>
    )
  return (
    <Section title="Connect Meta Ads">
      {status.pending ? (
        <div className="space-y-2">
          <p className="text-sm">Choose the ad account for this store:</p>
          {status.accountError && <p className="text-sm text-red-500">{status.accountError}</p>}
          {!status.accounts.length && !status.accountError && (
            <p className="text-sm text-foreground-muted">This Facebook user has no ad accounts.</p>
          )}
          {status.accounts.map((a: any) => (
            <button
              key={a.id}
              type="button"
              className={`${btnGhost} w-full justify-between`}
              onClick={() => post({ adAccountId: a.id })}
            >
              <span>{a.name}</span>
              <span className="text-xs text-foreground-muted">
                {a.id} · {a.currency}
              </span>
            </button>
          ))}
          <a className="text-xs underline" href="/api/admin/integrations/meta-ads/connect">
            Sign in with a different Facebook user
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {status.oauth?.enabled && (
            <a className={btnPrimary} href="/api/admin/integrations/meta-ads/connect">
              Connect with Facebook
            </a>
          )}
          <div className="grid gap-2 md:grid-cols-3 items-end">
            <label className="text-xs text-foreground-muted md:col-span-2">
              Or a system user access token (Business Settings, does not expire)
              <input
                className={inputCls}
                type="password"
                value={manual.accessToken}
                onChange={e => setManual(m => ({ ...m, accessToken: e.target.value }))}
              />
            </label>
            <label className="text-xs text-foreground-muted">
              Ad account id
              <input
                className={inputCls}
                placeholder="act_123..."
                value={manual.adAccountId}
                onChange={e => setManual(m => ({ ...m, adAccountId: e.target.value.trim() }))}
              />
            </label>
          </div>
          <button
            type="button"
            className={btnPrimary}
            disabled={!manual.accessToken || !manual.adAccountId}
            onClick={() => post(manual)}
          >
            Connect
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-red-500 mt-2">{msg}</p>}
    </Section>
  )
}

const statusTone = (s: string | null) =>
  s === 'ACTIVE'
    ? 'green'
    : s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED'
      ? 'amber'
      : s === 'DISAPPROVED'
        ? 'red'
        : 'muted'
const kpiCols = [
  { key: 'spend', label: 'Spend', num: true, render: (r: any) => money(r.spend), sort: (r: any) => r.spend },
  {
    key: 'purchases',
    label: 'Purchases',
    num: true,
    render: (r: any) => count(r.purchases),
    sort: (r: any) => r.purchases,
  },
  { key: 'value', label: 'Value', num: true, render: (r: any) => money(r.value), sort: (r: any) => r.value },
  {
    key: 'roas',
    label: 'ROAS',
    num: true,
    render: (r: any) => (r.roas == null ? '-' : `${r.roas.toFixed(2)}x`),
    sort: (r: any) => r.roas ?? 0,
  },
  {
    key: 'cpa',
    label: 'Cost / purchase',
    num: true,
    render: (r: any) => money(r.cpa),
    sort: (r: any) => r.cpa ?? 1e12,
  },
  {
    key: 'clicks',
    label: 'Link clicks',
    num: true,
    render: (r: any) => count(r.linkClicks),
    sort: (r: any) => r.linkClicks,
  },
  { key: 'ctr', label: 'CTR', num: true, render: (r: any) => pct(r.ctr, 2), sort: (r: any) => r.ctr ?? 0 },
]

function Body({ tab, d, status, onChanged }: { tab: MadsTab; d: any; status: any; onChanged: () => void }) {
  const canManage = useCanWrite('meta_ads_campaigns')
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const dialog = pending && (
    <PreviewApply
      writeScope="meta_ads_campaigns:write"
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
            <Kpi label="Spend" value={money(k.spend)} delta={change(k.spend, p.spend)} invert />
            <Kpi
              label="Purchases (Meta)"
              value={count(k.purchases)}
              delta={change(k.purchases, p.purchases)}
              sub={money(k.value)}
            />
            <Kpi label="ROAS (Meta)" value={k.roas == null ? '-' : `${k.roas.toFixed(2)}x`} />
            <Kpi
              label="True ROAS"
              value={d.trueRoas == null ? '-' : `${d.trueRoas.toFixed(2)}x`}
              sub={`${count(d.ours.orders)} orders, ${money(d.ours.revenue)} in your store from Meta`}
              highlight
            />
            <Kpi label="Reach" value={count(k.reach)} sub={`${count(k.impressions)} impressions`} />
            <Kpi label="Cost / purchase" value={money(k.cpa)} sub={`CPC ${money(k.cpc, 2)}`} />
          </KpiGrid>
          <Section title="By day">
            {d.daily.length ? (
              <TrendChart
                points={d.daily.map((x: any) => ({
                  label: x.date,
                  spend: x.spend,
                  value: x.value,
                  linkClicks: x.linkClicks,
                }))}
                series={SERIES}
                ariaLabel="Meta spend and purchase value by day"
              />
            ) : (
              <Empty msg="No data yet. Sync now (top right)." />
            )}
          </Section>
          <p className="text-xs text-foreground-muted">
            True ROAS counts your own orders that came from Meta (a Meta click id or a facebook/instagram UTM source),
            so it does not depend on Meta&apos;s attribution.
          </p>
        </div>
      )
    }
    case 'campaigns':
    case 'adsets':
    case 'ads': {
      const level = tab === 'campaigns' ? 'campaign' : tab === 'adsets' ? 'adset' : 'ad'
      return (
        <Section title={TABS.find(t => t.id === tab)!.label}>
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.id}
            empty="Nothing synced yet."
            cols={[
              {
                key: 'name',
                label: 'Name',
                render: (r: any) => (
                  <span className="flex items-center gap-2">
                    {r.thumbnail && <img src={r.thumbnail} alt="" className="w-8 h-8 rounded object-cover" />}
                    {r.name}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (r: any) => <Badge tone={statusTone(r.effective ?? r.status)}>{r.effective ?? r.status}</Badge>,
              },
              ...(level !== 'ad'
                ? [{ key: 'budget', label: 'Daily budget', num: true, render: (r: any) => money(r.dailyBudget) }]
                : []),
              ...kpiCols,
              ...(canManage
                ? [
                    {
                      key: 'act',
                      label: '',
                      render: (r: any) => (
                        <span className="flex gap-2 text-xs">
                          <button
                            type="button"
                            className="underline"
                            onClick={() =>
                              setPending({
                                action: 'status',
                                level,
                                id: r.id,
                                status: r.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                              })
                            }
                          >
                            {r.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          </button>
                          {level !== 'ad' && r.dailyBudget != null && (
                            <button
                              type="button"
                              className="underline"
                              onClick={() => {
                                const v = window.prompt('New daily budget', String(r.dailyBudget))
                                if (v && Number(v) > 0)
                                  setPending({ action: 'budget', level, id: r.id, dailyBudget: Number(v) })
                              }}
                            >
                              Budget
                            </button>
                          )}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {dialog}
        </Section>
      )
    }
    case 'breakdowns': {
      const titles: Record<string, string> = { age_gender: 'Age and gender', placement: 'Placement', region: 'Region' }
      return (
        <div className="space-y-5">
          {Object.keys(titles).map(dim => (
            <Section key={dim} title={`${titles[dim]} (last 30 days)`}>
              <Table
                rows={d.breakdowns[dim] ?? []}
                rowKey={(r: any) => r.key}
                empty="No data yet."
                cols={[{ key: 'key', label: titles[dim], render: (r: any) => r.key }, ...kpiCols]}
              />
            </Section>
          ))}
        </div>
      )
    }
    case 'capi':
      return <CapiView d={d} status={status} onChanged={onChanged} />
    case 'alerts':
      return <ChannelAlerts channel="meta_ads" params={ALERT_PARAMS} />
    case 'changes':
      return <ChangeHistory channel="meta_ads" />
    case 'runs':
      return <JobRuns channel="meta_ads" labels={{ sync: 'Account sync', capi: 'Conversions API' }} />
  }
}

function CapiView({ d, status, onChanged }: { d: any; status: any; onChanged: () => void }) {
  const canWrite = useCanWrite('meta_ads')
  const [pixel, setPixel] = useState(status.pixelId ?? '')
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const c = d.counts ?? {}
  const keys = d.matchedKeys ?? {}
  const sent = Number(c.sent ?? 0)
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Sent, 30 days" value={count(sent)} highlight />
        <Kpi label="Failed" value={count(Number(c.failed ?? 0))} />
        <Kpi
          label="Not sent"
          value={count(Number(c.skipped ?? 0))}
          sub="buyer refused ad cookies, or nothing to match on"
        />
        <Kpi
          label="With email or phone"
          value={pct(sent ? Math.max(keys.em ?? 0, keys.ph ?? 0) / sent : null, 0)}
          sub="better matching in Meta"
        />
        <Kpi label="With a Meta click id" value={pct(sent ? (keys.fbc ?? 0) / sent : null, 0)} />
        <Kpi label="Last sent" value={c.last_sent ? when(c.last_sent) : '-'} />
      </KpiGrid>
      <Section title="Setup">
        <p className="text-xs text-foreground-muted mb-3">
          Each paid order (cash on delivery once delivered) is sent to Meta as a Purchase within 15 minutes, with the
          order id as the event id. Email and phone are hashed and only sent when the buyer accepted advertising
          cookies.
        </p>
        {canWrite ? (
          <div className="grid gap-2 md:grid-cols-3 items-end">
            <label className="text-xs text-foreground-muted">
              Pixel (dataset) id
              <input className={inputCls} value={pixel} onChange={e => setPixel(e.target.value.trim())} />
            </label>
            <label className="text-xs text-foreground-muted">
              Conversions API token {status.capiToken ? '(set; leave blank to keep)' : '(optional)'}
              <input className={inputCls} type="password" value={token} onChange={e => setToken(e.target.value)} />
            </label>
            <button
              type="button"
              className={btnPrimary}
              onClick={async () => {
                const r = await api('/api/admin/meta-ads/connection', {
                  method: 'POST',
                  json: { pixelId: pixel || null, ...(token ? { capiToken: token } : {}) },
                })
                setMsg(r.ok ? 'Saved.' : r.data.error || 'Could not save')
                if (r.ok) onChanged()
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <p className="text-sm">Pixel: {status.pixelId ?? 'not set'}</p>
        )}
        {msg && <p className="text-xs text-foreground-muted mt-2">{msg}</p>}
      </Section>
      <Section title="Recent events">
        <Table
          rows={d.recent ?? []}
          rowKey={(r: any) => `${r.order_id}:${r.event_name}`}
          empty="Nothing sent yet."
          cols={[
            { key: 'when', label: 'When', render: (r: any) => when(r.sent_at ?? r.created_at) },
            { key: 'order', label: 'Order', render: (r: any) => r.order_number ?? r.order_id },
            { key: 'value', label: 'Value', num: true, render: (r: any) => money(Number(r.value), 2) },
            { key: 'keys', label: 'Matched on', render: (r: any) => (r.matched_keys ?? []).join(', ') || '-' },
            {
              key: 'status',
              label: 'Status',
              render: (r: any) => (
                <span title={r.error ?? undefined}>
                  <Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'muted'}>
                    {r.status}
                  </Badge>
                </span>
              ),
            },
          ]}
        />
      </Section>
    </div>
  )
}
