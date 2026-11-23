'use client'

import { useState } from 'react'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, Tabs, change, count, pct, type Col } from '@/components/admin/channels/ui'
import { BarSeries } from '@/components/admin/traffic/charts'
import type { ShowcaseAcquisition, ShowcaseChannelRow, ShowcaseDrillRow } from '@/lib/traffic/showcase-types'
import { Change, Note, bucketLabel, rateText, ratio } from './shared'

type Drill = 'source' | 'campaign' | 'term' | 'content' | 'referrer'

const DRILLS: { id: Drill; label: string; empty: string }[] = [
  { id: 'source', label: 'Source / medium', empty: 'No visits in this period' },
  { id: 'campaign', label: 'UTM campaign', empty: 'No visits from links with a utm_campaign tag' },
  { id: 'term', label: 'UTM term', empty: 'No visits from links with a utm_term tag (ad keywords)' },
  { id: 'content', label: 'UTM content', empty: 'No visits from links with a utm_content tag (ad or post variant)' },
  { id: 'referrer', label: 'Referring site', empty: 'No visits from other sites in this period' },
]

export default function AcquisitionTab({ data }: { data: ShowcaseAcquisition }) {
  const [drill, setDrill] = useState<Drill>('source')
  const prev = new Map(data.previousChannels.map(c => [c.channel, c]))
  const t = data.totals
  if (!t.sessions && !t.leads) return <Empty msg="No visits or enquiries in this period yet." />

  const paid = data.channels.filter(c => c.paid)
  const paidSessions = paid.reduce((s, c) => s + c.sessions, 0)
  const paidLeads = paid.reduce((s, c) => s + c.leads, 0)

  const channelCols: Col<ShowcaseChannelRow>[] = [
    {
      key: 'label',
      label: 'Channel',
      sort: r => r.label,
      render: r => (
        <span className="flex items-center gap-1.5">
          {r.label}
          {r.paid && <Badge tone="amber">paid</Badge>}
        </span>
      ),
    },
    {
      key: 'sessions',
      label: 'Visits',
      num: true,
      sort: r => r.sessions,
      render: r => (
        <span className="flex flex-col items-end">
          {count(r.sessions)}
          <Change cur={r.sessions} prev={prev.get(r.channel)?.sessions ?? 0} />
        </span>
      ),
    },
    { key: 'new', label: 'First-time', num: true, sort: r => r.newVisitors, render: r => count(r.newVisitors) },
    { key: 'conv', label: 'Enquiry rate', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 1) },
    {
      key: 'leads',
      label: 'Enquiries',
      num: true,
      sort: r => r.leads,
      render: r => (
        <span className="flex flex-col items-end">
          {count(r.leads)}
          <Change cur={r.leads} prev={prev.get(r.channel)?.leads ?? 0} />
        </span>
      ),
    },
  ]

  const drillCols = (label: string): Col<ShowcaseDrillRow>[] => [
    { key: 'key', label, render: r => <span className="break-all">{r.key}</span>, sort: r => r.key },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'conv', label: 'Enquiry rate', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 1) },
    { key: 'leads', label: 'Enquiries', num: true, sort: r => r.leads, render: r => count(r.leads) },
  ]

  const rows = { source: data.sourceMedium, campaign: data.campaigns, term: data.terms, content: data.contents, referrer: data.referrers }[drill]
  const current = DRILLS.find(x => x.id === drill)!

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Visits" value={count(t.sessions)} />
        <Kpi label="Enquiries" value={count(t.leads)} sub={`${count(t.linkedLeads)} matched to a visit`} />
        <Kpi label="Tagged visits" value={count(t.taggedSessions)} sub={`${pct(ratio(t.taggedSessions, t.sessions), 0)} came from a UTM link or an ad`} />
        <Kpi label="Paid visits" value={count(paidSessions)} sub={`${pct(ratio(paidSessions, t.sessions), 0)} of visits`} />
        <Kpi label="Enquiries from ads" value={count(paidLeads)} sub={`${pct(ratio(paidLeads, t.linkedLeads), 0)} of matched enquiries`} />
        <Kpi label="Channels" value={count(data.channels.length)} delta={change(data.channels.length, data.previousChannels.length)} />
      </KpiGrid>

      <Section title="By channel">
        <Table rows={data.channels} cols={channelCols} rowKey={r => r.channel} empty="No channel data" />
      </Section>

      <Section title={`Paid vs organic visits by ${data.period.bucket}`}>
        <BarSeries
          stacked
          rows={data.paidTrend}
          label={r => bucketLabel(r.bucket, data.period.bucket)}
          series={[
            { key: 'organic', label: 'Organic and direct', color: 'rgba(148,163,184,0.7)' },
            { key: 'paid', label: 'Paid', color: '#f97316' },
          ]}
        />
      </Section>

      <Section title="Drill down">
        <div className="space-y-3">
          <Tabs<Drill> value={drill} onChange={setDrill} tabs={DRILLS.map(x => ({ id: x.id, label: x.label }))} />
          <Table key={drill} rows={rows} cols={drillCols(current.label)} rowKey={r => r.key} empty={current.empty} />
        </div>
      </Section>

      <Note>
        A visit is grouped by how it landed: a Google, Meta or Microsoft ad click, the link&apos;s UTM tags, else the site
        that sent it. Enquiries count toward the visit they came from. Add utm_source, utm_medium and utm_campaign to the
        links you share (Instagram bio, WhatsApp status, ads) to see each one here.
      </Note>
    </div>
  )
}
