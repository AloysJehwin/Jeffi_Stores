'use client'

import Link from 'next/link'
import { Download, Inbox } from 'lucide-react'
import { Badge, Kpi, KpiGrid, Section, Table, btnGhost, change, count, when, type Col } from '@/components/admin/channels/ui'
import { BarSeries, HBars } from '@/components/admin/traffic/charts'
import type { LeadRow, ShowcaseLeads } from '@/lib/traffic/showcase-types'
import { Note, bucketLabel, countryName, rateText } from './shared'

const UNLINKED = 'Not linked to a visit'

function Breakdown({ title, rows, color, empty }: { title: string; rows: { key: string; leads: number }[]; color?: string; empty: string }) {
  return (
    <Section title={title}>
      <HBars empty={empty} color={color} rows={rows.map(r => ({ key: r.key, label: r.key === UNLINKED ? <span className="text-foreground-muted">{r.key}</span> : r.key, value: r.leads }))} />
    </Section>
  )
}

export default function LeadsTab({ data, csvHref, inboxHref }: { data: ShowcaseLeads; csvHref: string; inboxHref: string }) {
  const t = data.totals
  const cols: Col<LeadRow>[] = [
    { key: 'at', label: 'Received', sort: r => r.createdAt, render: r => when(r.createdAt) },
    {
      key: 'who',
      label: 'From',
      sort: r => r.name.toLowerCase(),
      render: r => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{r.name}</span>
          <span className="text-xs text-foreground-muted">{[r.phone, r.email].filter(Boolean).join(' · ') || '-'}</span>
        </span>
      ),
    },
    { key: 'msg', label: 'Message', render: r => <span className="block max-w-[22rem] truncate text-foreground-secondary" title={r.message ?? ''}>{r.message || '-'}</span> },
    {
      key: 'channel',
      label: 'Came from',
      sort: r => r.channel ?? '',
      render: r =>
        r.channel ? (
          <span className="flex flex-col">
            {r.channel}
            <span className="text-xs text-foreground-muted break-all">{[r.source, r.campaign].filter(Boolean).join(' · ')}</span>
          </span>
        ) : (
          <span className="text-foreground-muted">{UNLINKED}</span>
        ),
    },
    { key: 'device', label: 'Device', sort: r => r.device ?? '', render: r => (r.device ? `${r.device}${r.country ? ` · ${countryName(r.country)}` : ''}` : '-') },
    { key: 'status', label: 'Status', sort: r => (r.readAt ? 1 : 0), render: r => <Badge tone={r.readAt ? 'muted' : 'amber'}>{r.readAt ? 'Handled' : 'New'}</Badge> },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Enquiries" value={count(t.leads)} delta={change(t.leads, t.previous)} highlight />
        <Kpi label="Waiting for a reply" value={count(t.unread)} sub="All time, not marked handled" href={inboxHref} />
        <Kpi label="Form enquiry rate" value={rateText(t.linked, t.sessions, 1)} sub={`${count(t.linked)} of ${count(t.sessions)} visits`} />
        <Kpi label="Contact taps" value={count(t.contactSessions)} sub="Visits that tapped call, WhatsApp or email" />
        <Kpi label="Matched to a visit" value={rateText(t.linked, t.leads, 0)} sub={`${count(t.linked)} of ${count(t.leads)} enquiries`} />
      </KpiGrid>

      <Section title={`Enquiries by ${data.period.bucket}`}>
        <BarSeries rows={data.trend} label={r => bucketLabel(r.bucket, data.period.bucket)} series={[{ key: 'leads', label: 'Enquiries', color: '#84cc16' }]} />
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Breakdown title="By channel" rows={data.byChannel} empty="No enquiries in this period" />
        <Breakdown title="By source" rows={data.bySource} color="rgba(59,130,246,0.6)" empty="No enquiries in this period" />
        <Breakdown title="By campaign" rows={data.byCampaign} color="rgba(249,115,22,0.6)" empty="No enquiries from UTM-tagged links in this period" />
        <Breakdown title="By device" rows={data.byDevice} color="rgba(168,85,247,0.6)" empty="No enquiries in this period" />
      </div>

      <Section title="When enquiries arrive (IST)">
        <BarSeries rows={data.byHour.map(h => ({ ...h, label: `${h.hour}:00` }))} label={r => r.label} series={[{ key: 'leads', label: 'Enquiries', color: '#3b82f6' }]} height={110} />
      </Section>

      <Section
        title="Enquiries in this period"
        action={
          <span className="flex flex-wrap gap-2">
            <a href={csvHref} className={btnGhost} download>
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <Link href={inboxHref} className={btnGhost}>
              <Inbox className="h-4 w-4" /> Open inbox
            </Link>
          </span>
        }
      >
        <Table rows={data.rows} cols={cols} rowKey={r => r.id} empty="No enquiries in this period" noun="enquiries" />
        {data.truncated && (
          <div className="mt-2">
            <Note>Showing the newest {count(data.rows.length)}. The CSV export has every enquiry in the period.</Note>
          </div>
        )}
      </Section>

      <Note>
        An enquiry is matched to the visit it came from when the same browser visited in the six hours before it, so a
        form sent with scripts turned off, or from another network, shows as not linked.
      </Note>
    </div>
  )
}
