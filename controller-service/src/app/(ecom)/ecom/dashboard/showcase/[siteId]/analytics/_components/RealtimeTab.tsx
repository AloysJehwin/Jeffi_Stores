'use client'

import { Badge, Kpi, KpiGrid, Section, Table, count, when, type Col } from '@/components/admin/channels/ui'
import { BarSeries, HBars } from '@/components/admin/traffic/charts'
import type { ShowcaseRealtime } from '@/lib/traffic/showcase-types'
import { Note, countryName, targetLabel } from './shared'

type Sess = ShowcaseRealtime['sessions'][number]
type Ev = ShowcaseRealtime['events'][number]
type Lead = ShowcaseRealtime['leads'][number]

const ago = (iso: string, now: string) => {
  const m = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60000))
  return m === 0 ? 'now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}

const EVENT_LABELS: Record<string, string> = { click: 'Tapped', form_start: 'Started the form', form_submit: 'Sent the form' }

export default function RealtimeTab({ data }: { data: ShowcaseRealtime }) {
  const sessCols: Col<Sess>[] = [
    {
      key: 'source',
      label: 'Came from',
      render: r => (
        <span className="flex flex-col">
          <span className="break-all">{r.source}</span>
          <span className="text-xs text-foreground-muted">{r.channel}</span>
        </span>
      ),
    },
    { key: 'device', label: 'Device', render: r => `${r.device}${r.country ? ` · ${countryName(r.country)}` : ''}` },
    { key: 'scroll', label: 'Seen', num: true, sort: r => r.scroll, render: r => `${r.scroll}%` },
    {
      key: 'did',
      label: 'Did',
      render: r =>
        r.contacted || r.formStarted ? (
          <span className="flex gap-1">
            {r.contacted && <Badge tone="green">tapped contact</Badge>}
            {r.formStarted && <Badge tone="amber">form</Badge>}
          </span>
        ) : (
          '-'
        ),
    },
    { key: 'seen', label: 'Last seen', num: true, sort: r => r.lastSeen, render: r => ago(r.lastSeen, data.at) },
  ]
  const evCols: Col<Ev>[] = [
    { key: 'what', label: 'What', render: r => (r.type === 'click' && r.target ? `${EVENT_LABELS.click} ${targetLabel(r.target).toLowerCase()}` : EVENT_LABELS[r.type] ?? r.type) },
    { key: 'label', label: 'Detail', render: r => r.label || '-' },
    { key: 'at', label: 'When', num: true, render: r => ago(r.at, data.at) },
  ]
  const leadCols: Col<Lead>[] = [
    { key: 'name', label: 'From', render: r => r.name },
    { key: 'channel', label: 'Came from', render: r => r.channel ?? <span className="text-foreground-muted">Not linked to a visit</span> },
    { key: 'at', label: 'Received', render: r => when(r.createdAt) },
  ]
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Visitors now" value={count(data.activeSessions)} sub="Last 30 minutes" highlight />
        <Kpi label="Page views" value={count(data.pageviews)} sub="Last 30 minutes" />
        <Kpi label="Contact taps" value={count(data.sessions.filter(s => s.contacted).length)} sub="Last 30 minutes" />
        <Kpi label="Enquiries" value={count(data.leads.length)} sub="Last 24 hours" />
      </KpiGrid>

      <Section title="Page views per minute">
        <BarSeries rows={data.perMinute} label={r => r.minute} series={[{ key: 'views', label: 'Views', color: '#84cc16' }]} height={100} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Where they came from">
          <HBars empty="No one is on your site right now" color="rgba(148,163,184,0.7)" rows={data.sources.map(s => ({ key: s.key, label: s.key, value: s.sessions }))} />
        </Section>
        <Section title="What they did">
          <Table rows={data.events} cols={evCols} rowKey={r => `${r.at}|${r.type}|${r.target}|${r.label}`} empty="No taps or form activity in the last 30 minutes" />
        </Section>
      </div>

      <Section title="Visitors in the last 30 minutes">
        <Table rows={data.sessions} cols={sessCols} rowKey={r => r.sessionId} empty="No visits in the last 30 minutes" />
      </Section>

      <Section title="Enquiries in the last 24 hours">
        <Table rows={data.leads} cols={leadCols} rowKey={r => r.id} empty="No enquiries in the last 24 hours" />
      </Section>
      <Note>Refreshes every 30 seconds while this tab is open. Updated {when(data.at)}.</Note>
    </div>
  )
}
