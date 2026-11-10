'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ExternalLink, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import DatePicker from '@/components/ui/DatePicker'
import { TrendChart, type SeriesDef } from '@/components/admin/kit/charts'
import { PageHeader } from '@/components/admin/kit/layout'
import { EmptyState, ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { ChannelAlerts } from '@/components/admin/channels/ChannelPanels'
import { Badge, Banner, Empty, Kpi, KpiGrid, RangePresets, Section, Table, Tabs, api, btnGhost, btnPrimary, change, count, lastDays, money, pct, when } from '@/components/admin/channels/ui'
import ColumnMapper from './ColumnMapper'
import { LoadingTable } from '@/components/admin/kit/skeleton'
import { IMPORT_HISTORY_COLUMNS, MarketplaceAdsTabLoading } from './skeletons'
import { ap } from '@/lib/shared/admin-path'
import { AD_FIELDS, type AdsChannel } from '@/lib/marketplace-ads/columns'
import type { MadsTab } from '@/lib/marketplace-ads/console'
import type { PreviewResult } from '@/lib/marketplace-ads/import'

type Tab = 'overview' | 'campaigns' | 'products' | 'import' | 'alerts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'products', label: 'Products' },
  { id: 'import', label: 'Import' },
  { id: 'alerts', label: 'Alerts' },
]
const DATA_TABS = new Set<Tab>(['overview', 'campaigns', 'products'])

const INFO: Record<AdsChannel, { title: string; path: string; api: string; portal: string; portalUrl: string }> = {
  myntra_ads: { title: 'Myntra Ads', path: '/admin/myntra-ads', api: '/api/admin/myntra-ads', portal: 'Myntra Partner Portal', portalUrl: 'https://partners.myntrainfo.com' },
  ajio_ads: { title: 'AJIO Ads', path: '/admin/ajio-ads', api: '/api/admin/ajio-ads', portal: 'AJIO Seller Central', portalUrl: 'https://seller.ajio.com' },
}

const SERIES: SeriesDef[] = [
  { key: 'cost', label: 'Spend', color: 'rgb(239 68 68)', kind: 'line', axis: 'money', on: true },
  { key: 'sales', label: 'Ad sales', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
  { key: 'clicks', label: 'Clicks', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
]
const ALERT_PARAMS = { maxAcos: 'max ACoS %', minSpend: 'minimum spend', days: 'days' }

/** Myntra Ads / AJIO Ads. Neither marketplace has an ads API, so the numbers come from report imports. */
export default function MarketplaceAdsConsole({ channel }: { channel: AdsChannel }) {
  const router = useRouter()
  const sp = useSearchParams()
  const info = INFO[channel]
  const tabParam = sp.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [range, setRange] = useState(() => lastDays(30, 1))
  const [loaded, setLoaded] = useState<{ key: string; data: any } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const canWrite = useCanWrite(channel)
  const key = `${tab}|${range.from}|${range.to}|${reloadKey}`
  const data = loaded?.key === key ? loaded.data : null

  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(sp.toString())
    params.set('tab', next)
    router.push(`${ap(info.path)}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (!DATA_TABS.has(tab)) return
    setError(null)
    api(`${info.api}/console?${new URLSearchParams({ tab: tab as MadsTab, ...range })}`).then(r =>
      r.ok ? setLoaded({ key, data: r.data.data }) : setError(r.data.error || 'Could not load')
    )
  }, [key, tab, range, info.api])

  const portalLink = (
    <a href={info.portalUrl} target="_blank" rel="noopener noreferrer" className={btnGhost}>
      <ExternalLink className="w-4 h-4" /> <span className="hidden sm:inline">Open</span> {info.portal}
    </a>
  )

  return (
    <div className="space-y-5">
      <PageHeader title={info.title} description="Spend, sales, campaigns and products from the reports you import" actions={portalLink} />
      {DATA_TABS.has(tab) && <RangePresets value={range} onChange={setRange} endOffset={1} />}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'import' ? (
        <ImportTab channel={channel} canWrite={canWrite} onDone={() => setReloadKey(k => k + 1)} />
      ) : tab === 'alerts' ? (
        <ChannelAlerts channel={channel} params={ALERT_PARAMS} />
      ) : error ? (
        <ErrorState body={error} />
      ) : !data ? (
        <MarketplaceAdsTabLoading tab={tab} />
      ) : (
        <Body tab={tab} d={data} info={info} portalLink={portalLink} onImport={canWrite ? () => setTab('import') : undefined} />
      )}
    </div>
  )
}

const kpiCols = [
  { key: 'cost', label: 'Spend', num: true, render: (r: any) => money(r.cost), sort: (r: any) => r.cost },
  { key: 'sales', label: 'Sales', num: true, render: (r: any) => money(r.sales), sort: (r: any) => r.sales },
  { key: 'acos', label: 'ACoS', num: true, render: (r: any) => pct(r.acos), sort: (r: any) => r.acos ?? 999 },
  { key: 'clicks', label: 'Clicks', num: true, render: (r: any) => count(r.clicks), sort: (r: any) => r.clicks },
  { key: 'ctr', label: 'CTR', num: true, render: (r: any) => pct(r.ctr, 2), sort: (r: any) => r.ctr ?? 0 },
  { key: 'cpc', label: 'CPC', num: true, render: (r: any) => money(r.cpc, 2), sort: (r: any) => r.cpc ?? 0 },
  { key: 'orders', label: 'Orders', num: true, render: (r: any) => count(r.orders), sort: (r: any) => r.orders },
  { key: 'units', label: 'Units', num: true, render: (r: any) => count(r.units), sort: (r: any) => r.units },
]

function Body({ tab, d, info, portalLink, onImport }: { tab: Tab; d: any; info: (typeof INFO)[AdsChannel]; portalLink: React.ReactNode; onImport?: () => void }) {
  switch (tab) {
    case 'overview': {
      if (!d.coverage)
        return (
          <EmptyState
            icon={<FileSpreadsheet className="h-5 w-5" />}
            title={`Import a report from the ${info.portal}`}
            body="There is no ads API, so the numbers come from the advertising reports you download there (CSV or Excel). Importing the same report again replaces it."
            actionNode={
              <div className="flex flex-wrap justify-center gap-2">
                {onImport && (
                  <button type="button" className={btnPrimary} onClick={onImport}>
                    <Upload className="w-4 h-4" /> Import a report
                  </button>
                )}
                {portalLink}
              </div>
            }
          />
        )
      const k = d.kpis
      const p = d.previous
      return (
        <div className="space-y-5">
          <KpiGrid>
            <Kpi label="Spend" value={money(k.cost)} delta={change(k.cost, p.cost)} invert />
            <Kpi label="Ad sales" value={money(k.sales)} delta={change(k.sales, p.sales)} />
            <Kpi label="ACoS" value={pct(k.acos)} sub="spend / ad sales" highlight />
            <Kpi label="ROAS" value={k.roas == null ? '-' : `${k.roas.toFixed(2)}x`} />
            <Kpi label="CTR" value={pct(k.ctr, 2)} sub={`${count(k.clicks)} clicks of ${count(k.impressions)}`} />
            <Kpi label="CPC" value={money(k.cpc, 2)} />
            <Kpi label="Orders" value={count(k.orders)} sub={`${count(k.units)} units`} />
          </KpiGrid>
          <Section title="By day">
            {d.daily.length ? (
              <TrendChart points={d.daily.map((x: any) => ({ label: x.date, cost: x.cost, sales: x.sales, clicks: x.clicks }))} series={SERIES} ariaLabel={`${info.title} spend and sales by day`} />
            ) : (
              <Empty msg="No report rows in this period." />
            )}
          </Section>
          <p className="text-xs text-foreground-muted">
            Reports cover {d.coverage.from} to {d.coverage.to}.
            {d.lastImport && ` Last import ${when(d.lastImport.imported_at)}: ${d.lastImport.file_name ?? 'report'} (${d.lastImport.date_from} to ${d.lastImport.date_to}).`}
          </p>
        </div>
      )
    }
    case 'campaigns':
      return (
        <Section title="Campaigns">
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.campaignKey || '-'}
            empty="No campaign rows in this period. Import a campaign report."
            cols={[
              { key: 'name', label: 'Campaign', render: (r: any) => <span className="block max-w-[16rem] truncate" title={r.name}>{r.name}</span> },
              { key: 'groups', label: 'Ad groups', num: true, render: (r: any) => (r.adGroups ? count(r.adGroups) : '-'), sort: (r: any) => r.adGroups },
              ...kpiCols,
            ]}
          />
        </Section>
      )
    case 'products':
      return (
        <Section title="Advertised products">
          <Table
            rows={d.rows}
            rowKey={(r: any) => r.productKey}
            empty="No product rows in this period. Import a product report (with SKU or style ID)."
            cols={[
              {
                key: 'name',
                label: 'Product',
                render: (r: any) => (
                  <span className="block max-w-[16rem]">
                    <span className="block truncate" title={r.name ?? r.productKey}>{r.name ?? r.productKey}</span>
                    <span className="block truncate text-xs text-foreground-muted">
                      {r.sku ?? r.styleId}
                      {!r.matched && ' · not matched to the catalogue'}
                    </span>
                  </span>
                ),
              },
              {
                key: 'stock',
                label: 'Stock',
                render: (r: any) => (r.stockStatus ? <Badge tone={/out/i.test(r.stockStatus) ? 'red' : /low/i.test(r.stockStatus) ? 'amber' : 'green'}>{r.stockStatus}</Badge> : '-'),
              },
              ...kpiCols,
              {
                key: 'profit',
                label: 'Profit after ads',
                num: true,
                render: (r: any) =>
                  r.profitAfterAds == null ? (
                    <span className="text-xs text-foreground-muted">{r.matched ? 'no cost price' : '-'}</span>
                  ) : (
                    <span className={r.profitAfterAds < 0 ? 'text-red-500' : ''}>{money(r.profitAfterAds)}</span>
                  ),
                sort: (r: any) => r.profitAfterAds ?? -1e12,
              },
            ]}
          />
          <p className="mt-3 text-xs text-foreground-muted">Profit after ads: ad sales without GST, less the catalogue cost price per unit sold, less spend.</p>
        </Section>
      )
    default:
      return null
  }
}

const FIELDS = AD_FIELDS.map(f => ({ key: f.key, label: f.label, required: f.required, hint: f.hint }))

function ImportTab({ channel, canWrite, onDone }: { channel: AdsChannel; canWrite: boolean; onDone: () => void }) {
  const info = INFO[channel]
  const toast = useActionToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [period, setPeriod] = useState({ from: '', to: '' })
  const [allowErrors, setAllowErrors] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [history, setHistory] = useState<any[] | null>(null)
  const seq = useRef(0)

  const loadHistory = useCallback(() => {
    api(`${info.api}/console?tab=imports`).then(r => setHistory(r.ok ? r.data.data.rows : []))
  }, [info.api])
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const form = (f: File, m: Record<string, string | null> | null, p: { from: string; to: string }) => {
    const fd = new FormData()
    fd.append('file', f)
    if (m) fd.append('mapping', JSON.stringify(m))
    if (p.from && p.to) {
      fd.append('from', p.from)
      fd.append('to', p.to)
    }
    return fd
  }

  async function runPreview(f: File, m: Record<string, string | null> | null, p: { from: string; to: string }) {
    const id = ++seq.current
    setBusy('preview')
    setProblems([])
    const r = await api<{ data: PreviewResult }>(`${info.api}/import?step=preview`, { method: 'POST', body: form(f, m, p) })
    if (id !== seq.current) return
    setBusy(null)
    if (!r.ok) {
      setPreview(null)
      setProblems([r.data.error || 'Could not read the report'])
      return
    }
    const pv = r.data.data
    setPreview(pv)
    setMapping(Object.fromEntries(FIELDS.map(x => [x.key, pv.mapping[x.key as keyof typeof pv.mapping] ?? null])))
    if (pv.range && !(p.from && p.to)) setPeriod(pv.range)
    setAllowErrors(false)
  }

  function choose(f: File | null) {
    setFile(f)
    setPreview(null)
    setPeriod({ from: '', to: '' })
    if (f) runPreview(f, null, { from: '', to: '' })
  }

  function reset() {
    seq.current++
    setFile(null)
    setPreview(null)
    setProblems([])
    setPeriod({ from: '', to: '' })
    setBusy(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function commit() {
    if (!file || !preview) return
    setBusy('commit')
    setProblems([])
    const fd = form(file, mapping, period)
    if (allowErrors) fd.append('allowErrors', 'true')
    const r = await api(`${info.api}/import?step=commit`, { method: 'POST', body: fd })
    setBusy(null)
    if (!r.ok || !r.data.ok) {
      setProblems(r.data.problems?.length ? r.data.problems : [r.data.error || 'The import failed'])
      return
    }
    const res = r.data.result
    toast.result({
      ok: true,
      text: `Imported ${count(res.rows)} rows (${res.range.from} to ${res.range.to})${res.replaced ? `, replacing ${count(res.replaced)} earlier rows` : ''}.`,
    })
    reset()
    loadHistory()
    onDone()
  }

  const pv = preview
  const canCommit = !!pv && !pv.problems.length && pv.rowCount > 0 && (!pv.errorCount || allowErrors) && busy === null

  return (
    <div className="space-y-5">
      {canWrite ? (
        <Section
          title="Import a report"
          action={
            file && (
              <button type="button" className={btnGhost} onClick={reset} aria-label="Start over">
                <X className="w-4 h-4" /> <span className="hidden sm:inline">Start over</span>
              </button>
            )
          }
        >
          {!file ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground-muted">
                Download a campaign or product (SKU / style) report from the {info.portal} as CSV or Excel, then upload it here. You match its columns once; the mapping is
                remembered for the next file. Importing a period again replaces it, so nothing is counted twice.
              </p>
              <label className={`${btnPrimary} cursor-pointer w-fit`}>
                <Upload className="w-4 h-4" /> Choose a file
                <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" onChange={e => choose(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="w-4 h-4 shrink-0 text-foreground-muted" />
                <span className="min-w-0 break-all font-medium">{file.name}</span>
                {pv && <Badge tone="blue">{pv.kind === 'product' ? 'Product report' : 'Campaign report'}</Badge>}
                {busy === 'preview' && <span className="text-xs text-foreground-muted">Reading...</span>}
              </div>
              {pv && (
                <p className="text-xs text-foreground-muted">
                  Sheet {pv.sheet}, headers on row {pv.headerRow}.{' '}
                  {pv.mappingSource === 'saved' ? 'Columns matched from your last import.' : pv.mappingSource === 'suggested' ? 'Columns matched automatically; check them below.' : ''}
                </p>
              )}
              {problems.length > 0 && (
                <Banner ok={false}>
                  {problems.map(p => (
                    <p key={p}>{p}</p>
                  ))}
                </Banner>
              )}
              {pv && (
                <>
                  <ColumnMapper
                    fields={FIELDS}
                    headers={pv.headers}
                    value={mapping}
                    samples={pv.samples}
                    disabled={busy === 'commit'}
                    onChange={next => {
                      setMapping(next)
                      if (file) runPreview(file, next, pv.hasDate || next.date ? { from: '', to: '' } : period)
                    }}
                  />
                  {pv.problems.length > 0 && (
                    <Banner ok={false}>
                      {pv.problems.map(p => (
                        <p key={p}>{p}</p>
                      ))}
                    </Banner>
                  )}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground-secondary">
                      {pv.hasDate ? 'Period to replace (widen it to clear days the report leaves out)' : 'This report has no date column. Pick the period it covers:'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <DatePicker
                        aria-label="From"
                        value={period.from}
                        max={period.to || undefined}
                        onChange={v => {
                          const next = { ...period, from: v }
                          setPeriod(next)
                          if (next.from && next.to) runPreview(file, mapping, next)
                        }}
                      />
                      <span className="text-foreground-muted">to</span>
                      <DatePicker
                        aria-label="To"
                        value={period.to}
                        min={period.from || undefined}
                        onChange={v => {
                          const next = { ...period, to: v }
                          setPeriod(next)
                          if (next.from && next.to) runPreview(file, mapping, next)
                        }}
                      />
                    </div>
                  </div>
                  {!pv.problems.length && (
                    <>
                      <KpiGrid>
                        <Kpi label="Rows" value={count(pv.rowCount)} sub={pv.skipped ? `${count(pv.skipped)} total rows skipped` : undefined} />
                        <Kpi label="Spend" value={money(pv.totals.cost)} />
                        <Kpi label="Ad sales" value={money(pv.totals.sales)} />
                        <Kpi label="ACoS" value={pct(pv.totals.acos)} />
                        <Kpi label="Replaces" value={pv.range ? `${pv.range.from} to ${pv.range.to}` : '-'} sub={pv.existingRows ? `${count(pv.existingRows)} rows there now` : 'nothing imported there yet'} />
                      </KpiGrid>
                      <Table
                        rows={pv.rows}
                        rowKey={(r: any) => String(r.line)}
                        empty="No rows to import."
                        cols={[
                          { key: 'line', label: 'Row', num: true, render: (r: any) => r.line },
                          { key: 'date', label: 'Date', render: (r: any) => r.date },
                          {
                            key: 'what',
                            label: pv.kind === 'product' ? 'Product' : 'Campaign',
                            render: (r: any) => (
                              <span className="block max-w-[14rem] truncate">
                                {pv.kind === 'product' ? `${r.productKey}${r.productName ? ` · ${r.productName}` : ''}` : `${r.campaignName ?? r.campaignId}${r.adGroup ? ` / ${r.adGroup}` : ''}`}
                              </span>
                            ),
                          },
                          { key: 'impr', label: 'Impr.', num: true, render: (r: any) => count(r.impressions) },
                          { key: 'clicks', label: 'Clicks', num: true, render: (r: any) => count(r.clicks) },
                          { key: 'spend', label: 'Spend', num: true, render: (r: any) => money(r.spend, 2) },
                          { key: 'orders', label: 'Orders', num: true, render: (r: any) => count(r.orders) },
                          { key: 'units', label: 'Units', num: true, render: (r: any) => count(r.units) },
                          { key: 'sales', label: 'Sales', num: true, render: (r: any) => money(r.sales, 2) },
                        ]}
                      />
                      {pv.rowCount > pv.rows.length && <p className="text-xs text-foreground-muted">Showing the first {pv.rows.length} of {count(pv.rowCount)} rows.</p>}
                    </>
                  )}
                  {pv.errorCount > 0 && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                      <p className="text-sm font-medium">
                        {count(pv.errorCount)} row{pv.errorCount === 1 ? ' has' : 's have'} problems
                      </p>
                      <ul className="max-h-48 overflow-y-auto space-y-0.5 text-xs text-foreground-muted">
                        {pv.errors.map(e => (
                          <li key={e.line}>
                            Row {e.line}: {e.message}
                          </li>
                        ))}
                      </ul>
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={allowErrors} onChange={e => setAllowErrors(e.target.checked)} />
                        <span>Import the other rows and leave these out</span>
                      </label>
                    </div>
                  )}
                  <button type="button" className={btnPrimary} disabled={!canCommit} onClick={commit}>
                    {busy === 'commit' ? 'Importing...' : `Import ${count(pv.rowCount)} row${pv.rowCount === 1 ? '' : 's'}`}
                  </button>
                </>
              )}
            </div>
          )}
        </Section>
      ) : (
        <p className="text-sm text-foreground-muted">You can see the import history; importing needs {info.title} write access.</p>
      )}
      <Section title="Import history">
        {!history ? (
          <LoadingTable bare columns={IMPORT_HISTORY_COLUMNS} rows={4} />
        ) : (
          <Table
            rows={history}
            rowKey={(r: any) => r.id}
            empty="Nothing imported yet."
            cols={[
              { key: 'when', label: 'Imported', render: (r: any) => when(r.imported_at), sort: (r: any) => r.imported_at, sortType: 'date' },
              { key: 'file', label: 'File', render: (r: any) => <span className="block max-w-[14rem] truncate" title={r.file_name ?? ''}>{r.file_name ?? '-'}</span> },
              { key: 'kind', label: 'Kind', render: (r: any) => (r.kind === 'product' ? 'Products' : 'Campaigns') },
              { key: 'period', label: 'Period', render: (r: any) => `${r.date_from} to ${r.date_to}` },
              { key: 'rows', label: 'Rows', num: true, render: (r: any) => count(r.row_count), sort: (r: any) => r.row_count },
              { key: 'replaced', label: 'Replaced', num: true, render: (r: any) => count(r.replaced_count) },
              { key: 'spend', label: 'Spend', num: true, render: (r: any) => money(r.totals?.cost) },
              { key: 'by', label: 'By', render: (r: any) => r.imported_by_email ?? '-' },
            ]}
          />
        )}
      </Section>
    </div>
  )
}
