'use client'

import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Inbox } from 'lucide-react'
import { Tabs, btnGhost } from '@/components/admin/channels/ui'
import { ErrorState } from '@/components/admin/kit/states'
import { PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { SHOWCASE_TABS, parseShowcaseTab, type ShowcaseTab, type ShowcaseTabData } from '@/lib/traffic/showcase-types'
import type { ShowcaseStatus } from '@/lib/showcase/types'
import PageHeader from '../../../_components/PageHeader'
import OverviewTab from './_components/OverviewTab'
import AcquisitionTab from './_components/AcquisitionTab'
import BehaviourTab from './_components/BehaviourTab'
import FunnelTab from './_components/FunnelTab'
import LeadsTab from './_components/LeadsTab'
import AudienceTab from './_components/AudienceTab'
import RealtimeTab from './_components/RealtimeTab'
import AnalyticsTabLoading from './_components/AnalyticsLoading'

const LABELS: Record<ShowcaseTab, string> = {
  overview: 'Overview',
  acquisition: 'Acquisition',
  behaviour: 'Behaviour',
  funnel: 'Funnel',
  leads: 'Leads',
  audience: 'Audience',
  realtime: 'Real-time',
}

const secondary =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-secondary'

/** The admin Traffic page's layout over one Showcase: tabs in ?tab, the period in ?from&to. */
export default function AnalyticsClient({ siteId, name, host, status, tenantSlug }: { siteId: string; name: string; host: string; status: ShowcaseStatus; tenantSlug: string }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tab = parseShowcaseTab(sp.get('tab'))
  const [period, setPeriod] = usePeriod('30d')
  const live = tab === 'realtime'
  const base = `/api/ecom/showcase/${siteId}/analytics?tenant=${encodeURIComponent(tenantSlug)}`
  const url = live ? `${base}&tab=realtime` : `${base}&tab=${tab}&from=${period.from}&to=${period.to}`
  const { data, error, loading, reload } = useOverviewData<{ tab: ShowcaseTab } & Record<string, any>>(url)

  const setTab = useCallback(
    (next: ShowcaseTab) => {
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
  const t = `?tenant=${encodeURIComponent(tenantSlug)}`

  return (
    <>
      <PageHeader
        eyebrow="Showcase analytics"
        title={name}
        description={`Who visits ${host}, where they come from, what they do there and which visits bring enquiries.`}
        actions={
          <>
            <Link href={`/dashboard/showcase/${siteId}${t}`} className={secondary}>
              <ArrowLeft className="h-4 w-4" /> Site
            </Link>
            <Link href={`/dashboard/showcase/${siteId}/leads${t}`} className={secondary}>
              <Inbox className="h-4 w-4" /> Enquiries
            </Link>
          </>
        }
      />

      <div className="space-y-5">
        {status !== 'live' && (
          <p className="rounded-xl org-peach px-4 py-3 text-sm text-foreground">
            {status === 'draft'
              ? 'This site isn’t published yet. Visits are counted once it is live, and not when you open it from this console.'
              : 'This site is paused. New visits aren’t counted until it is live again; the figures below are from when it was live.'}
          </p>
        )}

        <Tabs<ShowcaseTab> tabs={SHOWCASE_TABS.map(id => ({ id, label: LABELS[id] }))} value={tab} onChange={setTab} />

        {live ? (
          <p className="text-xs text-foreground-muted">Live: visits in the last 30 minutes and enquiries in the last day.</p>
        ) : (
          <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
        )}

        {error ? (
          <ErrorState body={error} actionNode={<button type="button" onClick={reload} className={btnGhost}>Try again</button>} />
        ) : !ready ? (
          <AnalyticsTabLoading tab={tab} />
        ) : (
          <TabBody key={key} tab={tab} data={ready} csvHref={`${base}&format=csv&from=${period.from}&to=${period.to}`} inboxHref={`/dashboard/showcase/${siteId}/leads${t}`} />
        )}
      </div>
    </>
  )
}

function TabBody({ tab, data, csvHref, inboxHref }: { tab: ShowcaseTab; data: any; csvHref: string; inboxHref: string }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab data={data as ShowcaseTabData['overview']} />
    case 'acquisition':
      return <AcquisitionTab data={data as ShowcaseTabData['acquisition']} />
    case 'behaviour':
      return <BehaviourTab data={data as ShowcaseTabData['behaviour']} />
    case 'funnel':
      return <FunnelTab data={data as ShowcaseTabData['funnel']} />
    case 'leads':
      return <LeadsTab data={data as ShowcaseTabData['leads']} csvHref={csvHref} inboxHref={inboxHref} />
    case 'audience':
      return <AudienceTab data={data as ShowcaseTabData['audience']} />
    case 'realtime':
      return <RealtimeTab data={data as ShowcaseTabData['realtime']} />
  }
}
