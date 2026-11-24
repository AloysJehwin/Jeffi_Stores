'use client'

import { Empty, Kpi, KpiGrid, Section, change, count, pct } from '@/components/admin/channels/ui'
import { AttentionList } from '@/components/admin/overview/kit'
import { CHART_MUTED, BarSeries, HBars, chartColor } from '@/components/admin/traffic/charts'
import type { ShowcaseOverview } from '@/lib/traffic/showcase-types'
import { Note, bucketLabel, duration, rateText, ratio, targetLabel } from './shared'

export default function OverviewTab({ data }: { data: ShowcaseOverview }) {
  const c = data.current
  const p = data.previous
  if (c.sessions === 0 && c.leads === 0)
    return <Empty msg="No visits in this period yet. Visits are recorded as people open your site; share its link to bring some." />

  const d = (a: number | null, b: number | null) => (a == null || b == null ? null : change(a, b))
  const engaged = ratio(c.engagedSessions, c.sessions)
  const prevEngaged = ratio(p.engagedSessions, p.sessions)
  const time = ratio(c.engagedMs, c.sessions)
  const prevTime = ratio(p.engagedMs, p.sessions)
  const scroll = ratio(c.scrollSum, c.sessions)
  const prevScroll = ratio(p.scrollSum, p.sessions)
  const conv = ratio(c.convertedSessions, c.sessions)
  const prevConv = ratio(p.convertedSessions, p.sessions)

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Visitors" value={count(c.visitors)} delta={change(c.visitors, p.visitors)} sub="Counted by network and device" />
        <Kpi label="Visits" value={count(c.sessions)} delta={change(c.sessions, p.sessions)} sub={`${count(c.newVisitors)} first-time`} />
        <Kpi label="Page views" value={count(c.pageviews)} delta={change(c.pageviews, p.pageviews)} />
        <Kpi label="Engaged visits" value={pct(engaged, 0)} delta={d(engaged, prevEngaged)} sub="10 s or longer, or an action" />
        <Kpi label="Time on page" value={duration(time)} delta={d(time, prevTime)} sub="Average per visit" />
        <Kpi label="Page seen" value={scroll == null ? '-' : `${Math.round(scroll)}%`} delta={d(scroll, prevScroll)} sub="Average scroll depth" />
        <Kpi label="Enquiries" value={count(c.leads)} delta={change(c.leads, p.leads)} sub={data.unreadLeads ? `${count(data.unreadLeads)} waiting for a reply` : 'From your contact form'} />
        <Kpi label="Contact taps" value={count(c.contactSessions)} delta={change(c.contactSessions, p.contactSessions)} sub="Tapped call, WhatsApp or email" />
        <Kpi label="Contact rate" value={pct(conv, 1)} delta={d(conv, prevConv)} highlight sub="Enquired or tapped to contact" />
      </KpiGrid>

      <AttentionList items={data.attention} />

      <Section title={`Visits and enquiries by ${data.period.bucket}`}>
        <BarSeries
          rows={data.trend}
          label={r => bucketLabel(r.bucket, data.period.bucket)}
          series={[
            { key: 'sessions', label: 'Visits', color: CHART_MUTED },
            { key: 'contacts', label: 'Contact taps', color: chartColor(1) },
            { key: 'leads', label: 'Enquiries', color: chartColor(2) },
          ]}
        />
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <Section title="Top sources">
          <HBars
            empty="No visits yet"
            rows={data.topSources.map(s => ({ key: s.channel, label: s.label, value: s.sessions, right: `${count(s.sessions)} · ${rateText(s.convertedSessions, s.sessions)}` }))}
          />
        </Section>
        <Section title="Taps on your contacts and links">
          <HBars
            empty="No taps yet"
            color={chartColor(1)}
            rows={data.clicks.map(k => ({ key: k.target, label: targetLabel(k.target), value: k.clicks, right: `${count(k.clicks)} · ${count(k.sessions)} visits` }))}
          />
        </Section>
        <Section title="Top referring sites">
          <HBars
            empty="No visits from other sites yet"
            color={chartColor(3)}
            rows={data.topReferrers.map(r => ({ key: r.key, label: r.key, value: r.sessions, right: `${count(r.sessions)} · ${count(r.leads)} enquiries` }))}
          />
        </Section>
      </div>
      <Note>
        Enquiries count every message from your contact form in the period. The contact rate counts visits that sent one or
        tapped to call, WhatsApp or email. Percentages next to a source are its contact rate. Visits you open from this
        console, and visits while the site is a draft or paused, are not counted.
      </Note>
    </div>
  )
}
