'use client'

import Link from 'next/link'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, pct, when } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket } from '@/lib/overview/period'
import type { MessagingState, MessagingTotals } from '@/lib/overviews/marketing-messaging'
import { ap } from '@/lib/shared/admin-path'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { MESSAGING_FIELDS, MESSAGING_SEARCH } from '@/lib/filters/fields/messaging'

interface Data {
  bucket: Bucket
  current: MessagingTotals
  previous_totals: MessagingTotals
  channels: { channel: string; sent: number; delivered: number; failed: number; spend: number; total: number }[]
  failures: { key: string; label: string; count: number; channels: string[] }[]
  series: { label: string; email: number; whatsapp: number; sms: number; push: number; failed: number }[]
  broadcasts: {
    id: string
    title: string
    template: string
    sent_at: string | null
    recipients: number
    messages: number
    failed: number
    wa_cap: number
  }[]
  templates: { kind: string; channel: string; count: number; failed: number; spend: number }[]
  state: MessagingState
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'email', label: 'Email', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'whatsapp', label: 'WhatsApp', color: 'rgb(34 197 94)', kind: 'bar', axis: 'count', on: true },
  { key: 'sms', label: 'SMS', color: 'rgb(168 85 247)', kind: 'bar', axis: 'count', on: false },
  { key: 'push', label: 'App push', color: 'rgb(249 115 22)', kind: 'bar', axis: 'count', on: false },
  { key: 'failed', label: 'Failed', color: 'rgb(239 68 68)', kind: 'line', axis: 'count', on: true },
]
const CHANNEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'App push' }
const human = (s: string) => s.replace(/_/g, ' ')

export default function MessagingOverview() {
  const [period, setPeriod] = usePeriod()
  // KPIs and charts follow the broadcast list's filters (then only broadcasts count); the
  // PeriodBar owns from / to.
  const filters = useFilterQuery(MESSAGING_FIELDS, { omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/marketing/messaging/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const c = data?.current
  const p = data?.previous_totals

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters entity="messaging" fields={MESSAGING_FIELDS} search={MESSAGING_SEARCH} period noun="Messages" tab="overview" exportable />
      {filters && <p className="text-xs text-foreground-muted">Filtered: only the matching broadcasts count; automated WhatsApp and SMS are left out.</p>}
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data || !c || !p ? (
        !error && <OverviewSkeleton />
      ) : (
        <>
          <KpiGrid>
            <Kpi
              label="Messages"
              value={count(c.messages)}
              delta={delta(c.messages, p.messages)}
              sub={`${count(c.broadcasts)} broadcasts`}
            />
            <Kpi label="Email" value={count(c.emails)} delta={delta(c.emails, p.emails)} />
            <Kpi
              label="WhatsApp"
              value={count(c.whatsapp)}
              delta={delta(c.whatsapp, p.whatsapp)}
              sub={`SMS ${count(c.sms)}`}
            />
            <Kpi
              label="Failed"
              value={count(c.failed)}
              delta={delta(c.failed, p.failed)}
              invert
              sub={`${pct(c.failure_rate)} of messages`}
            />
            <Kpi
              label="Marketing cap (63049)"
              value={count(c.wa_cap)}
              delta={delta(c.wa_cap, p.wa_cap)}
              invert
              sub="held back by Meta"
            />
            <Kpi
              label="Spend"
              value={money(c.spend, 2)}
              delta={delta(c.spend, p.spend)}
              invert
              sub={c.priced ? `${count(c.priced)} priced sends` : 'no provider prices yet'}
              highlight
            />
          </KpiGrid>

          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Messages by channel">
                <TrendChart
                  points={data.series}
                  series={SERIES}
                  bucket={data.bucket}
                  height={220}
                  ariaLabel="Messages by channel over time"
                />
              </Section>
            </div>
            <Section title="Failure reasons">
              {data.failures.length ? (
                <ul className="space-y-2 text-sm">
                  {data.failures.map(f => (
                    <li key={f.key} className="flex justify-between gap-3">
                      <span
                        className={
                          f.key === '63049' ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-foreground'
                        }
                      >
                        {f.label}
                        <span className="block text-xs text-foreground-muted">
                          {f.channels.map(ch => CHANNEL[ch] ?? ch).join(', ')}
                        </span>
                      </span>
                      <span className="tabular-nums text-foreground-muted">{count(f.count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground-muted">No failed messages in this period.</p>
              )}
            </Section>
          </div>

          <Section title="By channel and status">
            <Table
              rows={data.channels}
              rowKey={r => r.channel}
              empty="No messages in this period."
              cols={[
                { key: 'ch', label: 'Channel', render: r => CHANNEL[r.channel] ?? r.channel },
                { key: 'total', label: 'Total', num: true, render: r => count(r.total), sort: r => r.total },
                { key: 'sent', label: 'Sent', num: true, render: r => count(r.sent), sort: r => r.sent },
                {
                  key: 'deliv',
                  label: 'Delivered',
                  num: true,
                  render: r => count(r.delivered),
                  sort: r => r.delivered,
                },
                { key: 'failed', label: 'Failed', num: true, render: r => count(r.failed), sort: r => r.failed },
                { key: 'spend', label: 'Spend', num: true, render: r => money(r.spend, 2), sort: r => r.spend },
              ]}
            />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section
              title="Broadcasts sent"
              action={
                <Link
                  href={ap('/admin/marketing/messaging?tab=list')}
                  className="text-xs text-accent-500 hover:underline"
                >
                  All messages
                </Link>
              }
            >
              <Table
                rows={data.broadcasts}
                rowKey={r => r.id}
                empty="No broadcasts sent in this period."
                cols={[
                  {
                    key: 'title',
                    label: 'Title',
                    render: r => (
                      <Link
                        href={ap(`/admin/marketing/messaging/${r.id}/view`)}
                        className="text-accent-500 hover:underline line-clamp-1"
                      >
                        {r.title}
                      </Link>
                    ),
                  },
                  { key: 'tpl', label: 'Template', render: r => <span className="text-xs">{human(r.template)}</span> },
                  { key: 'sent', label: 'Sent', render: r => when(r.sent_at) },
                  { key: 'msgs', label: 'Messages', num: true, render: r => count(r.messages), sort: r => r.messages },
                  {
                    key: 'failed',
                    label: 'Failed',
                    num: true,
                    render: r =>
                      r.failed ? (
                        <span className="text-red-500">
                          {count(r.failed)}
                          {r.wa_cap ? ` (${r.wa_cap} cap)` : ''}
                        </span>
                      ) : (
                        '-'
                      ),
                    sort: r => r.failed,
                  },
                ]}
              />
            </Section>
            <Section title="Templates used (WhatsApp and SMS)">
              <Table
                rows={data.templates}
                rowKey={r => `${r.kind}:${r.channel}`}
                empty="No WhatsApp or SMS sent in this period."
                cols={[
                  { key: 'kind', label: 'Template', render: r => human(r.kind) },
                  { key: 'ch', label: 'Channel', render: r => CHANNEL[r.channel] ?? r.channel },
                  { key: 'n', label: 'Sent', num: true, render: r => count(r.count), sort: r => r.count },
                  { key: 'failed', label: 'Failed', num: true, render: r => count(r.failed), sort: r => r.failed },
                  { key: 'spend', label: 'Spend', num: true, render: r => money(r.spend, 2), sort: r => r.spend },
                ]}
              />
            </Section>
          </div>
          {(data.state.scheduled > 0 || data.state.drafts > 0) && (
            <p className="text-xs text-foreground-muted">
              {count(data.state.scheduled)} scheduled
              {data.state.next_scheduled ? ` (next ${when(String(data.state.next_scheduled))})` : ''} ·{' '}
              {count(data.state.drafts)} drafts
            </p>
          )}
        </>
      )}
    </div>
  )
}
