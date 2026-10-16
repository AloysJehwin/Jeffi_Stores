'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Calculator, FileBarChart, RefreshCw, Trophy } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, Tabs, api } from '@/components/admin/channels/ui'
import { ChangeHistory, ChannelAlerts, JobRuns } from '@/components/admin/channels/ChannelPanels'
import AmazonMerchantPanel from './AmazonMerchantPanel'
import { BuyboxView, FeesView, OrdersStockView, OverviewView, RepricerView, SalesView, SuppressedView } from './AmazonTabs'

type Tab = 'overview' | 'sales' | 'orders' | 'listings' | 'suppressed' | 'buybox' | 'fees' | 'repricer' | 'alerts' | 'changes' | 'runs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales & payouts' },
  { id: 'orders', label: 'Orders & stock' },
  { id: 'listings', label: 'Listings & push' },
  { id: 'suppressed', label: 'Suppressed' },
  { id: 'buybox', label: 'Buy Box & pricing' },
  { id: 'fees', label: 'Fees & margin' },
  { id: 'repricer', label: 'Repricer' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]
const DATA_TABS = new Set<Tab>(['overview', 'sales', 'suppressed', 'buybox', 'fees', 'repricer'])
const ALERT_PARAMS = { minOffers: 'minimum offers', minMarginPct: 'margin %', hours: 'hours', units: 'units' }
const RUN_LABELS = { pricing: 'Buy Box and repricer', fees: 'Fee estimates', orders: 'Order import', stock: 'Stock push', reports: 'Sales reports' }

export default function AmazonConsole({ connected }: { connected: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [loaded, setLoaded] = useState<{ tab: string; data: any } | null>(null)
  const data = loaded?.tab === tab ? loaded.data : null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const canWrite = useCanWrite('amazon')

  useEffect(() => {
    if (!connected || !DATA_TABS.has(tab)) return
    setError(null)
    api(`/api/admin/amazon/console?tab=${tab}`).then(r => (r.ok ? setLoaded({ tab, data: r.data.data }) : setError(r.data.error || 'Failed to load')))
  }, [tab, connected, reloadKey])

  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.push(`${ap('/admin/amazon')}?${params.toString()}`, { scroll: false })
  }

  async function refresh(kind: 'status' | 'offers' | 'fees' | 'reports') {
    setBusy(kind)
    setBanner(null)
    const r = await api('/api/admin/amazon/console/refresh', { method: 'POST', json: { kind } })
    setBusy(null)
    if (!r.ok) setBanner({ ok: false, text: r.data.error || 'Refresh failed' })
    else if (r.data.status && r.data.status !== 'success')
      setBanner({ ok: false, text: `Refreshed with problems: ${(r.data.errors ?? []).map((e: any) => `${e.step}: ${e.message}`).join('; ')}` })
    else setBanner({ ok: true, text: kind === 'status' ? 'Listing status refreshed.' : kind === 'offers' ? 'Buy Box and offers refreshed.' : kind === 'reports' ? 'Reports collected; a new sales report is requested and arrives on the next run.' : 'Fee estimates refreshed.' })
    reload()
  }

  if (!connected) {
    return <Banner ok={false}>Amazon is not connected. Use the gear icon (top right) to connect your Amazon Seller account, then come back here.</Banner>
  }

  return (
    <div className="space-y-4">
      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={setTab}
        actions={
          canWrite && (
            <>
              <IconButton icon={RefreshCw} label="Refresh listing status" busy={busy === 'status'} onClick={() => refresh('status')} />
              <IconButton icon={Trophy} label="Refresh Buy Box and offers" busy={busy === 'offers'} onClick={() => refresh('offers')} />
              <IconButton icon={Calculator} label="Refresh fee estimates" busy={busy === 'fees'} onClick={() => refresh('fees')} />
              <IconButton icon={FileBarChart} label="Collect sales reports and settlements" busy={busy === 'reports'} onClick={() => refresh('reports')} />
            </>
          )
        }
      />
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : DATA_TABS.has(tab) && !data ? (
        <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
      ) : (
        <Body tab={tab} data={data} onChanged={reload} />
      )}
    </div>
  )
}

function Body({ tab, data, onChanged }: { tab: Tab; data: any; onChanged: () => void }) {
  switch (tab) {
    case 'overview':
      return <OverviewView d={data} />
    case 'sales':
      return <SalesView d={data} />
    case 'orders':
      return <OrdersStockView onChanged={onChanged} />
    case 'listings':
      return <AmazonMerchantPanel />
    case 'suppressed':
      return <SuppressedView d={data} />
    case 'buybox':
      return <BuyboxView d={data} onChanged={onChanged} />
    case 'fees':
      return <FeesView d={data} />
    case 'repricer':
      return <RepricerView d={data} onChanged={onChanged} />
    case 'alerts':
      return <ChannelAlerts channel="amazon" params={ALERT_PARAMS} />
    case 'changes':
      return <ChangeHistory channel="amazon" />
    case 'runs':
      return <JobRuns channel="amazon" labels={RUN_LABELS} />
  }
}
