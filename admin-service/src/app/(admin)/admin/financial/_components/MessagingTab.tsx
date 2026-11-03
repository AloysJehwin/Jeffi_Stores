'use client'

import Link from 'next/link'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, pct, type Col } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { ap } from '@/lib/shared/admin-path'
import { delta } from '@/lib/overview/period'
import { KeyedTrendCard, MixDonutCard } from '@/components/admin/kit/charts'
import { FinancePeriodBar, useFinancePeriod, type FinanceOverviewContract } from './finance'

// Finance → Messaging. Spend across SMS / WhatsApp / email with the trend + mix split, plus four
// breakdowns (channel, direction, template, campaign) and a top-recipient list. Rows deep-link to
// existing routes — no modals; writes stay in /admin/marketing.

type ChannelKey = 'sms' | 'whatsapp' | 'email'
type DirectionKey = 'txn' | 'promo' | 'marketing'

interface Totals {
  total: number
  sms: number
  whatsapp: number
  email: number
  sends: number
  failed: number
}
interface ByChannel { key: ChannelKey; sends: number; failed: number; spent: number }
interface ByDirection { key: DirectionKey; sends: number; spent: number }
interface ByTemplate { slug: string; channel: ChannelKey; sends: number; spent: number }
interface ByCampaign { id: string; name: string; channel: ChannelKey; sends: number; spent: number }
interface TopRecipient { to: string; channel: ChannelKey; sends: number; spent: number }

interface Payload extends FinanceOverviewContract<Totals> {
  by_channel: ByChannel[]
  by_direction: ByDirection[]
  by_template: ByTemplate[]
  by_campaign: ByCampaign[]
  top_recipients: TopRecipient[]
}

const CHANNEL_KEYS: readonly ChannelKey[] = ['sms', 'whatsapp', 'email']
const CHANNEL_LABEL: Record<ChannelKey, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }
const CHANNEL_COLOR: Record<ChannelKey, string> = {
  sms: 'rgb(59 130 246)',
  whatsapp: 'rgb(16 185 129)',
  email: 'rgb(234 179 8)',
}

const DIRECTION_LABEL: Record<DirectionKey, string> = {
  txn: 'Transactional',
  promo: 'Promotional',
  marketing: 'Marketing',
}
const DIRECTION_HINT: Record<DirectionKey, string> = {
  txn: 'OTP, order updates, invoices.',
  promo: 'Coupons and offers.',
  marketing: 'Campaigns and newsletters.',
}

function ChannelPill({ k }: { k: ChannelKey }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLOR[k] }} aria-hidden />
      {CHANNEL_LABEL[k]}
    </span>
  )
}

export function MessagingTab() {
  const { range } = useFinancePeriod('30d')
  const { data, error, loading, reload } = useOverviewData<Payload>(
    `/api/admin/financial/messaging-spend?from=${range.from}&to=${range.to}`
  )
  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: Payload }) {
  const c = d.current
  const p = d.previous
  const failRate = c.sends ? c.failed / c.sends : null

  const dirCols: Col<ByDirection>[] = [
    {
      key: 'direction',
      label: 'Direction',
      render: r => (
        <div>
          <div className="text-foreground">{DIRECTION_LABEL[r.key]}</div>
          <div className="text-xs text-foreground-muted">{DIRECTION_HINT[r.key]}</div>
        </div>
      ),
    },
    { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends), sort: r => r.sends },
    { key: 'spent', label: 'Spent', num: true, render: r => money(r.spent, 2), sort: r => r.spent },
  ]

  const tplCols: Col<ByTemplate>[] = [
    {
      key: 'slug',
      label: 'Template',
      render: r => <span className="font-mono text-xs text-foreground">{r.slug}</span>,
      sort: r => r.slug,
    },
    { key: 'channel', label: 'Channel', render: r => <ChannelPill k={r.channel} />, sort: r => r.channel },
    { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends), sort: r => r.sends },
    { key: 'spent', label: 'Spent', num: true, render: r => money(r.spent, 2), sort: r => r.spent },
  ]

  const campCols: Col<ByCampaign>[] = [
    {
      key: 'name',
      label: 'Campaign',
      render: r => (
        <Link href={ap(`/admin/marketing/messaging/${r.id}`)} className="text-accent-500 hover:underline">
          {r.name}
        </Link>
      ),
      sort: r => r.name,
    },
    { key: 'channel', label: 'Channel', render: r => <ChannelPill k={r.channel} />, sort: r => r.channel },
    { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends), sort: r => r.sends },
    { key: 'spent', label: 'Spent', num: true, render: r => money(r.spent, 2), sort: r => r.spent },
  ]

  const rcpCols: Col<TopRecipient>[] = [
    {
      key: 'to',
      label: 'Recipient',
      render: r => (
        <Link
          href={ap(`/admin/customers?search=${encodeURIComponent(r.to)}`)}
          className="text-accent-500 hover:underline font-mono text-xs"
        >
          {r.to}
        </Link>
      ),
      sort: r => r.to,
    },
    { key: 'channel', label: 'Channel', render: r => <ChannelPill k={r.channel} />, sort: r => r.channel },
    { key: 'sends', label: 'Sends', num: true, render: r => count(r.sends), sort: r => r.sends },
    { key: 'spent', label: 'Spent', num: true, render: r => money(r.spent, 2), sort: r => r.spent },
  ]

  const totalFromChannels = d.by_channel.reduce((s, r) => s + r.spent, 0)

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi
          label="Total spend"
          value={money(c.total, 2)}
          delta={delta(c.total, p.total)}
          invert
          highlight
        />
        <Kpi label="SMS" value={money(c.sms, 2)} delta={delta(c.sms, p.sms)} invert sub={subFor(d.by_channel, 'sms')} />
        <Kpi label="WhatsApp" value={money(c.whatsapp, 2)} delta={delta(c.whatsapp, p.whatsapp)} invert sub={subFor(d.by_channel, 'whatsapp')} />
        <Kpi label="Email" value={money(c.email, 2)} delta={delta(c.email, p.email)} invert sub={subFor(d.by_channel, 'email')} />
        <Kpi label="Sends" value={count(c.sends)} delta={delta(c.sends, p.sends)} />
        <Kpi
          label="Failed"
          value={count(c.failed)}
          sub={failRate != null ? `${pct(failRate, 1)} bounced` : 'No bounces yet'}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Spend by channel"
            data={d.series ?? []}
            keys={[...CHANNEL_KEYS]}
            labels={CHANNEL_LABEL}
            granularity={d.bucket}
          />
        </div>
        <MixDonutCard
          title="By channel"
          segments={d.by_channel
            .filter(r => r.spent > 0)
            .map(r => ({ label: CHANNEL_LABEL[r.key], value: r.spent, color: CHANNEL_COLOR[r.key] }))}
          total={money(totalFromChannels)}
          totalLabel="Spent"
        />
      </div>

      <Section title="By direction">
        <Table rows={d.by_direction} cols={dirCols} rowKey={r => r.key} empty="No sends in this period." />
      </Section>

      <Section title="By template">
        <Table
          rows={d.by_template}
          cols={tplCols}
          rowKey={r => `${r.channel}|${r.slug}`}
          empty="No template sends in this period."
        />
      </Section>

      <Section title="By campaign">
        <Table
          rows={d.by_campaign}
          cols={campCols}
          rowKey={r => `${r.channel}|${r.id}`}
          empty="No campaign sends in this period."
        />
      </Section>

      <Section title="Top recipients">
        <Table
          rows={d.top_recipients}
          cols={rcpCols}
          rowKey={r => `${r.channel}|${r.to}`}
          empty="No recipients in this period."
        />
      </Section>
    </div>
  )
}

function subFor(by: ByChannel[], k: ChannelKey): string | undefined {
  const r = by.find(x => x.key === k)
  if (!r || !r.sends) return undefined
  const parts = [`${count(r.sends)} sends`]
  if (r.failed) parts.push(`${count(r.failed)} failed`)
  return parts.join(' · ')
}
