'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileBarChart, RefreshCw } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, RangePresets, Tabs, api, lastDays } from '@/components/admin/channels/ui'
import { ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { ChangeHistory, ChannelAlerts, JobRuns } from '@/components/admin/channels/ChannelPanels'
import type { MerchantTab } from '@/lib/merchant/console-data'
import GoogleMerchantPanel from './GoogleMerchantPanel'
import { BestSellersView, CompetitivenessView, InsightsView, IssuesView, OverviewView, PerformanceView } from './ReportTabs'
import { AccountView, PromotionsView, ShippingView } from './SettingsTabs'

const TABS: { id: MerchantTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Products & sync' },
  { id: 'issues', label: 'Issues' },
  { id: 'performance', label: 'Performance' },
  { id: 'competitiveness', label: 'Price competitiveness' },
  { id: 'insights', label: 'Price insights' },
  { id: 'bestsellers', label: 'Best sellers' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'shipping', label: 'Shipping & returns' },
  { id: 'account', label: 'Account' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'changes', label: 'Change history' },
  { id: 'runs', label: 'Job runs' },
]

// Tabs whose data comes from the console API (the rest render their own panels).
const DATA_TABS = new Set<MerchantTab>(['overview', 'issues', 'performance', 'competitiveness', 'insights', 'bestsellers', 'promotions', 'shipping', 'account'])
const RANGED = new Set<MerchantTab>(['overview', 'performance'])

const ALERT_PARAMS = { percent: '% threshold', minProducts: 'minimum products', minClicks: 'minimum clicks', days: 'days' }
const RUN_LABELS = { reports: 'Reports and account' }

export default function MerchantConsole({ connected }: { connected: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as MerchantTab | null
  const [tab, setTabState] = useState<MerchantTab>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview')
  const [range, setRange] = useState(() => lastDays(30, 1))
  const [loaded, setLoaded] = useState<{ tab: string; data: any } | null>(null)
  const data = loaded?.tab === tab ? loaded.data : null
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'reports' | 'status' | null>(null)
  const toast = useActionToast()
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const canWrite = useCanWrite('merchant_sync')

  useEffect(() => {
    if (!connected || !DATA_TABS.has(tab)) return
    setError(null)
    const qs = new URLSearchParams({ tab, from: range.from, to: range.to })
    api(`/api/admin/merchant/console?${qs}`).then(r => (r.ok ? setLoaded({ tab, data: r.data.data }) : setError(r.data.error || 'Failed to load')))
  }, [tab, range, connected, reloadKey])

  function setTab(next: MerchantTab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.push(`${ap('/admin/merchant')}?${params.toString()}`, { scroll: false })
  }

  async function refresh(kind: 'reports' | 'status') {
    setBusy(kind)
    const r = await api('/api/admin/merchant/console/refresh', { method: 'POST', json: { kind } })
    setBusy(null)
    if (!r.ok) toast.error(r.data.error || 'Refresh failed')
    else if (kind === 'status') toast.success(`Refreshed the status of ${r.data.summary?.total ?? 0} products from Google.`)
    else if (r.data.status === 'success') toast.success('Refreshed reports and account settings from Google.')
    else {
      const text = `Refreshed with problems: ${(r.data.errors ?? []).map((e: any) => `${e.step}: ${e.message}`).join('; ')}`
      if (r.data.status === 'error') toast.error(text)
      else toast.warning(text)
    }
    reload()
  }

  if (!connected) {
    return (
      <Banner ok={false}>
        Google Merchant Center is not connected. Use the gear icon (top right) to connect with Google or enter a service account, then come back here.
      </Banner>
    )
  }

  return (
    <div className="space-y-4">
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={setTab}
        actions={
          canWrite && (
            <>
              <IconButton icon={RefreshCw} label="Refresh product status from Google" busy={busy === 'status'} onClick={() => refresh('status')} />
              <IconButton icon={FileBarChart} label="Refresh reports and account from Google" busy={busy === 'reports'} onClick={() => refresh('reports')} />
            </>
          )
        }
      />
      {RANGED.has(tab) && <RangePresets value={range} onChange={setRange} endOffset={1} />}
      {error ? (
        <ErrorState body={error} />
      ) : DATA_TABS.has(tab) && !data ? (
        <div className="h-64 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
      ) : (
        <Body tab={tab} data={data} onChanged={reload} />
      )}
    </div>
  )
}

function Body({ tab, data, onChanged }: { tab: MerchantTab; data: any; onChanged: () => void }) {
  switch (tab) {
    case 'overview':
      return <OverviewView d={data} />
    case 'products':
      return <GoogleMerchantPanel />
    case 'issues':
      return <IssuesView d={data} />
    case 'performance':
      return <PerformanceView d={data} />
    case 'competitiveness':
      return <CompetitivenessView d={data} />
    case 'insights':
      return <InsightsView d={data} onChanged={onChanged} />
    case 'bestsellers':
      return <BestSellersView d={data} />
    case 'promotions':
      return <PromotionsView d={data} onChanged={onChanged} />
    case 'shipping':
      return <ShippingView d={data} onChanged={onChanged} />
    case 'account':
      return <AccountView d={data} />
    case 'alerts':
      return <ChannelAlerts channel="gmc" params={ALERT_PARAMS} />
    case 'changes':
      return <ChangeHistory channel="gmc" />
    case 'runs':
      return <JobRuns channel="gmc" labels={RUN_LABELS} />
  }
}
