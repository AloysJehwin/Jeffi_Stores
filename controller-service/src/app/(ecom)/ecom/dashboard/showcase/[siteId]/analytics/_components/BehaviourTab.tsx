'use client'

import { Empty, Section, Table, count, type Col } from '@/components/admin/channels/ui'
import { HBars, Heatmap } from '@/components/admin/traffic/charts'
import type { ShowcaseBehaviour } from '@/lib/traffic/showcase-types'
import { Note, rateText, ratio, targetLabel } from './shared'

const SCROLL_LABELS: Record<string, string> = { '0-24': 'Under a quarter', '25-49': 'A quarter to half', '50-74': 'Half to three quarters', '75-99': 'Most of it', '100': 'All of it' }
const ENGAGE_LABELS: Record<string, string> = { '<10s': 'Under 10 s', '10-30s': '10 to 30 s', '30s-1m': '30 s to 1 min', '1-3m': '1 to 3 min', '3-10m': '3 to 10 min', '10m+': 'Over 10 min' }

type Landing = ShowcaseBehaviour['landing'][number]
type Link = ShowcaseBehaviour['links'][number]
type Page = ShowcaseBehaviour['pages'][number]

export default function BehaviourTab({ data }: { data: ShowcaseBehaviour }) {
  const visits = data.scroll.reduce((s, r) => s + r.sessions, 0)
  if (!visits) return <Empty msg="No visits in this period yet." />

  const linkCols: Col<Link>[] = [
    { key: 'target', label: 'Kind', render: r => targetLabel(r.target), sort: r => r.target },
    { key: 'label', label: 'Where to', render: r => <span className="break-all">{r.label || '-'}</span>, sort: r => r.label },
    { key: 'clicks', label: 'Taps', num: true, sort: r => r.clicks, render: r => count(r.clicks) },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
  ]
  const landingCols: Col<Landing>[] = [
    { key: 'path', label: 'Landing page', render: r => <span className="break-all">{r.path}</span>, sort: r => r.path },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'engaged', label: 'Engaged', num: true, sort: r => ratio(r.engaged, r.sessions) ?? -1, render: r => rateText(r.engaged, r.sessions, 0) },
    { key: 'conv', label: 'Enquiry rate', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 1) },
    { key: 'leads', label: 'Enquiries', num: true, sort: r => r.leads, render: r => count(r.leads) },
  ]
  const pageCols: Col<Page>[] = [
    { key: 'path', label: 'Page', render: r => <span className="break-all">{r.path}</span>, sort: r => r.path },
    { key: 'views', label: 'Views', num: true, sort: r => r.views, render: r => count(r.views) },
    { key: 'sessions', label: 'Visits', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="How much of the page they saw">
          <HBars rows={data.scroll.map(r => ({ key: r.bucket, label: SCROLL_LABELS[r.bucket] ?? r.bucket, value: r.sessions, right: `${count(r.sessions)} · ${rateText(r.sessions, visits, 0)}` }))} />
        </Section>
        <Section title="Time on the page">
          <HBars
            color="rgba(59,130,246,0.6)"
            rows={data.engagement.map(r => ({ key: r.bucket, label: ENGAGE_LABELS[r.bucket] ?? r.bucket, value: r.sessions, right: `${count(r.sessions)} · ${rateText(r.sessions, visits, 0)}` }))}
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Taps by kind">
          <HBars
            empty="No one tapped a contact or link yet"
            color="rgba(168,85,247,0.6)"
            rows={data.clicks.map(k => ({ key: k.target, label: targetLabel(k.target), value: k.clicks, right: `${count(k.clicks)} · ${rateText(k.sessions, visits, 1)} of visits` }))}
          />
        </Section>
        <Section title="Links tapped">
          <Table rows={data.links} cols={linkCols} rowKey={r => `${r.target}|${r.label}`} empty="No one tapped a contact or link yet" />
        </Section>
      </div>

      <Section title="Landing pages">
        <Table rows={data.landing} cols={landingCols} rowKey={r => r.path} empty="No visits yet" />
      </Section>

      <Section title="Pages viewed">
        <Table rows={data.pages} cols={pageCols} rowKey={r => r.path} empty="No page views yet" />
      </Section>

      <Section title="Page views by weekday and hour (IST)">
        <Heatmap cells={data.heatmap} />
      </Section>

      <Note>
        Time on the page counts only while it is open on the visitor&apos;s screen. A visit is engaged when it lasts 10
        seconds or more, opens a second page, or taps to contact or starts the form.
      </Note>
    </div>
  )
}
