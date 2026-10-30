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
import { Badge, Banner, Kpi, KpiGrid, Section, Table, count, money, pct } from '@/components/admin/channels/ui'
import { DonutSplit, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket } from '@/lib/overview/period'
import type { LoyaltyTotals, ReferralTotals } from '@/lib/overviews/customer-programs'
import { TIER_KEYS, tierName } from '@/lib/loyalty/tiers'
import { ap } from '@/lib/shared/admin-path'

interface Person {
  id: string
  name: string
  email: string
}
interface Data {
  bucket: Bucket
  loyalty: {
    enabled: boolean
    current: LoyaltyTotals
    previous: LoyaltyTotals
    members: number
    by_tier: Record<string, number>
    outstanding_points: number
    liability: number
    redeemable_members: number
    series: { label: string; issued: number; redeemed: number }[]
    top_earners: (Person & { earned: number; redeemed: number; points: number; tier: string })[]
  }
  referrals: {
    enabled: boolean
    current: ReferralTotals
    previous: ReferralTotals
    all_time: { signups: number; referrers: number; pointsPaid: number }
    top_referrers: (Person & { signups: number; rewarded: number; revenue: number })[]
  }
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'issued', label: 'Points issued', color: 'rgb(34 197 94)', kind: 'bar', axis: 'count', on: true },
  { key: 'redeemed', label: 'Points redeemed', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count', on: true },
]
const TIER_COLORS: Record<string, string> = {
  bronze: 'rgb(180 83 9)',
  silver: 'rgb(148 163 184)',
  gold: 'rgb(234 179 8)',
  platinum: 'rgb(99 102 241)',
}

const customer = (p: Person) => (
  <Link href={ap(`/admin/customers/${p.id}/view`)} className="text-accent-500 hover:underline">
    {p.name}
  </Link>
)

export default function ProgramsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/customer-programs/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading || !data ? !error && <OverviewSkeleton /> : <Body data={data} />}
    </div>
  )
}

function Body({ data }: { data: Data }) {
  const l = data.loyalty
  const lc = l.current
  const lp = l.previous
  const r = data.referrals
  const rc = r.current
  const rp = r.previous
  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Loyalty</h2>
        <Badge tone={l.enabled ? 'green' : 'muted'}>{l.enabled ? 'On' : 'Off'}</Badge>
      </div>
      <KpiGrid>
        <Kpi
          label="Points issued"
          value={count(lc.issued)}
          delta={delta(lc.issued, lp.issued)}
          sub={`${count(lc.earning_orders)} orders`}
        />
        <Kpi
          label="Points redeemed"
          value={count(lc.redeemed)}
          delta={delta(lc.redeemed, lp.redeemed)}
          sub={`${pct(lc.redeem_rate)} of issued`}
        />
        <Kpi label="Points reversed" value={count(lc.reversed)} delta={delta(lc.reversed, lp.reversed)} invert />
        <Kpi
          label="Liability"
          value={money(l.liability)}
          sub={`${count(l.outstanding_points)} points held`}
          highlight
        />
        <Kpi
          label="Active members"
          value={count(lc.active_members)}
          delta={delta(lc.active_members, lp.active_members)}
          sub={`${count(l.members)} members in total`}
        />
        <Kpi
          label="New members"
          value={count(lc.new_members)}
          delta={delta(lc.new_members, lp.new_members)}
          sub={`${count(l.redeemable_members)} can redeem now`}
        />
      </KpiGrid>

      <AttentionList items={data.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Points issued and redeemed">
            <TrendChart
              points={l.series}
              series={SERIES}
              bucket={data.bucket}
              height={220}
              ariaLabel="Loyalty points issued and redeemed over time"
            />
          </Section>
        </div>
        <Section title="Members by tier">
          <DonutSplit
            segments={TIER_KEYS.map(k => ({ label: tierName(k), value: l.by_tier[k] ?? 0, color: TIER_COLORS[k] }))}
            centerLabel="members"
            centerValue={count(l.members)}
          />
        </Section>
      </div>

      <Section
        title="Top earners this period"
        action={
          <Link href={ap('/admin/customer-programs?tab=loyalty')} className="text-xs text-accent-500 hover:underline">
            All members
          </Link>
        }
      >
        <Table
          rows={l.top_earners}
          rowKey={x => x.id}
          empty="No points earned in this period."
          cols={[
            { key: 'name', label: 'Customer', render: customer, sort: x => x.name.toLowerCase() },
            { key: 'tier', label: 'Tier', render: x => <Badge>{tierName(x.tier)}</Badge>, sort: x => x.tier },
            { key: 'earned', label: 'Earned', num: true, render: x => count(x.earned), sort: x => x.earned },
            { key: 'redeemed', label: 'Redeemed', num: true, render: x => count(x.redeemed), sort: x => x.redeemed },
            { key: 'points', label: 'Balance', num: true, render: x => count(x.points), sort: x => x.points },
          ]}
        />
      </Section>

      <div className="flex items-center gap-2 pt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Refer & Earn</h2>
        <Badge tone={r.enabled ? 'green' : 'muted'}>{r.enabled ? 'On' : 'Off'}</Badge>
      </div>
      <KpiGrid>
        <Kpi label="Invites sent" value={count(rc.invites)} delta={delta(rc.invites, rp.invites)} />
        <Kpi
          label="Signups"
          value={count(rc.signups)}
          delta={delta(rc.signups, rp.signups)}
          sub={`${pct(rc.signup_rate)} of invites`}
        />
        <Kpi label="First orders" value={count(rc.first_orders)} delta={delta(rc.first_orders, rp.first_orders)} />
        <Kpi
          label="Referred revenue"
          value={money(rc.revenue)}
          delta={delta(rc.revenue, rp.revenue)}
          sub={`${count(rc.orders)} orders`}
          highlight
        />
        <Kpi
          label="Rewarded"
          value={count(rc.rewarded)}
          delta={delta(rc.rewarded, rp.rewarded)}
          sub={`${count(rc.points_paid)} points paid`}
        />
        <Kpi
          label="All-time signups"
          value={count(r.all_time.signups)}
          sub={`${count(r.all_time.referrers)} referrers`}
        />
      </KpiGrid>

      <Section
        title="Top referrers this period"
        action={
          <Link href={ap('/admin/customer-programs?tab=referrals')} className="text-xs text-accent-500 hover:underline">
            All referrals
          </Link>
        }
      >
        <Table
          rows={r.top_referrers}
          rowKey={x => x.id}
          empty="No referral signups in this period."
          cols={[
            { key: 'name', label: 'Referrer', render: customer, sort: x => x.name.toLowerCase() },
            { key: 'signups', label: 'Signups', num: true, render: x => count(x.signups), sort: x => x.signups },
            { key: 'rewarded', label: 'Rewarded', num: true, render: x => count(x.rewarded), sort: x => x.rewarded },
            {
              key: 'revenue',
              label: 'Referred revenue',
              num: true,
              render: x => money(x.revenue),
              sort: x => x.revenue,
            },
          ]}
        />
      </Section>
    </>
  )
}
