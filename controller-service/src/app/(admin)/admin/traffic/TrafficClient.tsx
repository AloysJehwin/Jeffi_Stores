'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import { OverviewSkeleton, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { TRAFFIC_TABS, parseTab, type TrafficTab, type TrafficTabData } from '@/lib/traffic/types'
import OverviewTab from './_components/OverviewTab'
import AcquisitionTab from './_components/AcquisitionTab'
import BehaviourTab from './_components/BehaviourTab'
import FunnelTab from './_components/FunnelTab'
import ProductsTab from './_components/ProductsTab'
import SearchTab from './_components/SearchTab'
import AudienceTab from './_components/AudienceTab'
import RealtimeTab from './_components/RealtimeTab'

const LABELS: Record<TrafficTab, string> = {
  overview: 'Overview',
  acquisition: 'Acquisition',
  behaviour: 'Behaviour',
  funnel: 'Funnel',
  products: 'Products',
  search: 'Search',
  audience: 'Audience',
  realtime: 'Real-time',
}

export default function TrafficClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  // Read on every render so back/forward and links switch the tab, not only the first mount.
  const tab = parseTab(sp.get('tab'))
  const [period, setPeriod] = usePeriod('30d')
  const live = tab === 'realtime'
  const url = live ? '/api/admin/traffic?tab=realtime' : `/api/admin/traffic?tab=${tab}&from=${period.from}&to=${period.to}`
  // Data is tagged with the URL it came from, so a tab never renders another tab's or period's data.
  const { data, error, loading, reload } = useOverviewData<{ tab: TrafficTab } & Record<string, any>>(url)

  const setTab = useCallback(
    (next: TrafficTab) => {
      const q = new URLSearchParams(sp.toString())
      q.set('tab', next)
      q.set('from', period.from)
      q.set('to', period.to)
      router.push(`${pathname}?${q}`, { scroll: false })
    },
    [sp, router, pathname, period.from, period.to]
  )

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload()
    }, 30_000)
    const onVisible = () => document.visibilityState === 'visible' && reload()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  const ready = data && data.tab === tab ? data : null
  const key = `${tab}|${period.from}|${period.to}`

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Traffic</h1>
        <p className="text-sm text-foreground-secondary mt-0.5">Visitors, where they come from and what they do</p>
      </div>

      <Tabs<TrafficTab> tabs={TRAFFIC_TABS.map(id => ({ id, label: LABELS[id] }))} value={tab} onChange={setTab} />

      {live ? (
        <p className="text-xs text-foreground-muted">Live: the last 30 minutes of visits and the last hour of orders.</p>
      ) : (
        <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      )}

      {error ? (
        <div className="flex items-center justify-center h-48 text-sm text-red-500">{error}</div>
      ) : !ready ? (
        <OverviewSkeleton />
      ) : (
        <TabBody key={key} tab={tab} data={ready} />
      )}
    </div>
  )
}

function TabBody({ tab, data }: { tab: TrafficTab; data: any }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab data={data as TrafficTabData['overview']} />
    case 'acquisition':
      return <AcquisitionTab data={data as TrafficTabData['acquisition']} />
    case 'behaviour':
      return <BehaviourTab data={data as TrafficTabData['behaviour']} />
    case 'funnel':
      return <FunnelTab data={data as TrafficTabData['funnel']} />
    case 'products':
      return <ProductsTab data={data as TrafficTabData['products']} />
    case 'search':
      return <SearchTab data={data as TrafficTabData['search']} />
    case 'audience':
      return <AudienceTab data={data as TrafficTabData['audience']} />
    case 'realtime':
      return <RealtimeTab data={data as TrafficTabData['realtime']} />
  }
}
