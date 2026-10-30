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
import { Badge, Banner, Kpi, KpiGrid, Section, Table, count, money, pct, when } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket } from '@/lib/overview/period'
import type { CampaignRowStats, CampaignStats, CampaignTotals } from '@/lib/overviews/campaigns'
import { ap } from '@/lib/shared/admin-path'

interface Data {
  bucket: Bucket
  current: CampaignTotals
  previous_totals: CampaignTotals
  enabled: number
  total_campaigns: number
  series: { label: string; sends: number; opened: number; clicked: number; converted: number }[]
  campaigns: (CampaignRowStats & { failed: number })[]
  channels: (CampaignStats & { channel: string })[]
  failures: { key: string; label: string; count: number; channels: string[] }[]
  idle: { kind: string; name: string; last_run_at: string | null }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'sends', label: 'Sends', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'opened', label: 'Opens', color: 'rgb(34 197 94)', kind: 'line', axis: 'count', on: true },
  { key: 'clicked', label: 'Clicks', color: 'rgb(224 123 63)', kind: 'line', axis: 'count', on: false },
  { key: 'converted', label: 'Conversions', color: 'rgb(168 85 247)', kind: 'line', axis: 'count', on: false },
]
const CHANNEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'App push' }

export default function CampaignsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/campaigns/overview?from=${period.from}&to=${period.to}`
  )
  const c = data?.current
  const p = data?.previous_totals

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data || !c || !p ? (
        !error && <OverviewSkeleton />
      ) : (
        <>
          <KpiGrid>
            <Kpi
              label="Sends"
              value={count(c.sends)}
              delta={delta(c.sends, p.sends)}
              sub={`${count(data.enabled)} of ${count(data.total_campaigns)} campaigns on`}
            />
            <Kpi
              label="Open rate"
              value={pct(c.open_rate)}
              delta={delta(c.open_rate, p.open_rate)}
              sub={`${count(c.opened)} opens (email)`}
            />
            <Kpi
              label="Click rate"
              value={pct(c.click_rate)}
              delta={delta(c.click_rate, p.click_rate)}
              sub={`${count(c.clicked)} clicks`}
            />
            <Kpi
              label="Conversions"
              value={count(c.converted)}
              delta={delta(c.converted, p.converted)}
              sub={`${pct(c.conversion_rate)} of sends`}
            />
            <Kpi
              label="Revenue"
              value={money(c.revenue)}
              delta={delta(c.revenue, p.revenue)}
              sub={`UTM-tagged: ${money(c.utm_revenue)}`}
              highlight
            />
            <Kpi
              label="Unsubscribes"
              value={count(c.unsubscribed)}
              delta={delta(c.unsubscribed, p.unsubscribed)}
              invert
              sub={`${count(c.bounced)} bounced`}
            />
          </KpiGrid>

          <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Sends and engagement">
                <TrendChart
                  points={data.series}
                  series={SERIES}
                  bucket={data.bucket}
                  height={220}
                  ariaLabel="Campaign sends, opens, clicks and conversions over time"
                />
              </Section>
            </div>
            <Section title="By channel">
              <Table
                rows={data.channels}
                rowKey={r => r.channel}
                empty="No sends in this period."
                cols={[
                  { key: 'ch', label: 'Channel', render: r => CHANNEL[r.channel] ?? r.channel },
                  { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends) },
                  { key: 'conv', label: 'Conv.', num: true, render: r => count(r.converted) },
                  { key: 'rev', label: 'Revenue', num: true, render: r => money(r.revenue) },
                ]}
              />
              {data.failures.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                    Failed WhatsApp / SMS
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {data.failures.map(f => (
                      <li key={f.key} className="flex justify-between gap-3">
                        <span className={f.key === '63049' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}>
                          {f.label}
                        </span>
                        <span className="tabular-nums text-foreground-muted">{count(f.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>

          <Section
            title="By campaign"
            action={
              <Link href={ap('/admin/campaigns?tab=list')} className="text-xs text-accent-500 hover:underline">
                All campaigns
              </Link>
            }
          >
            <Table
              rows={data.campaigns}
              rowKey={r => r.kind}
              empty="No campaign sends in this period."
              cols={[
                {
                  key: 'name',
                  label: 'Campaign',
                  render: r => (
                    <span className="inline-flex items-center gap-2">
                      <Link href={ap(`/admin/campaigns/${r.kind}`)} className="text-accent-500 hover:underline">
                        {r.name}
                      </Link>
                      {r.enabled === false && <Badge>Off</Badge>}
                    </span>
                  ),
                },
                { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends), sort: r => r.sends },
                {
                  key: 'push',
                  label: 'Push',
                  num: true,
                  render: r => (r.pushes ? `${count(r.pushes)}${r.push_opened ? ` · ${count(r.push_opened)} opened` : ''}` : '-'),
                  sort: r => r.pushes,
                },
                { key: 'open', label: 'Open', num: true, render: r => pct(r.open_rate), sort: r => r.open_rate ?? -1 },
                {
                  key: 'click',
                  label: 'Click',
                  num: true,
                  render: r => pct(r.click_rate),
                  sort: r => r.click_rate ?? -1,
                },
                { key: 'conv', label: 'Conv.', num: true, render: r => count(r.converted), sort: r => r.converted },
                { key: 'rev', label: 'Revenue', num: true, render: r => money(r.revenue), sort: r => r.revenue },
                {
                  key: 'unsub',
                  label: 'Unsub.',
                  num: true,
                  render: r => count(r.unsubscribed),
                  sort: r => r.unsubscribed,
                },
                {
                  key: 'failed',
                  label: 'Failed',
                  num: true,
                  render: r => (r.failed ? <span className="text-red-500">{count(r.failed)}</span> : '-'),
                  sort: r => r.failed,
                },
              ]}
            />
          </Section>

          {data.idle.length > 0 && (
            <Section title="On but not sending">
              <Table
                rows={data.idle}
                rowKey={r => r.kind}
                cols={[
                  {
                    key: 'name',
                    label: 'Campaign',
                    render: r => (
                      <Link href={ap(`/admin/campaigns/${r.kind}`)} className="text-accent-500 hover:underline">
                        {r.name}
                      </Link>
                    ),
                  },
                  { key: 'run', label: 'Last run', render: r => (r.last_run_at ? when(r.last_run_at) : 'Never') },
                ]}
              />
            </Section>
          )}
        </>
      )}
    </div>
  )
}
