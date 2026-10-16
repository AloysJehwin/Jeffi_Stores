'use client'

import Link from 'next/link'
import { Kpi, KpiGrid, Section, change, count, money, pct, Empty } from '@/components/admin/channels/ui'
import { AttentionList } from '@/components/admin/overview/kit'
import type { OverviewData } from '@/lib/traffic/types'
import { BarSeries, HBars } from './charts'
import { bucketLabel, productHref, rateText, ratio, toAttention } from './shared'

export default function OverviewTab({ data }: { data: OverviewData }) {
  const c = data.current
  const p = data.previous
  if (c.sessions === 0 && c.orders === 0)
    return <Empty msg="No tracked sessions in this period yet. Visits are recorded as shoppers browse the storefront." />

  const pps = ratio(c.pageviews, c.sessions)
  const prevPps = ratio(p.pageviews, p.sessions)
  const bounce = ratio(c.bounces, c.sessions)
  const prevBounce = ratio(p.bounces, p.sessions)
  const conv = ratio(c.convertedSessions, c.sessions)
  const prevConv = ratio(p.convertedSessions, p.sessions)
  const rps = ratio(c.revenue, c.sessions)
  const prevRps = ratio(p.revenue, p.sessions)
  const d = (a: number | null, b: number | null) => (a == null || b == null ? null : change(a, b))

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Visitors" value={count(c.visitors)} delta={change(c.visitors, p.visitors)} sub="By sign-in, else IP and device" />
        <Kpi label="Sessions" value={count(c.sessions)} delta={change(c.sessions, p.sessions)} />
        <Kpi label="Pageviews" value={count(c.pageviews)} delta={change(c.pageviews, p.pageviews)} />
        <Kpi label="Pages / session" value={pps == null ? '-' : pps.toFixed(1)} delta={d(pps, prevPps)} />
        <Kpi label="Bounce rate" value={pct(bounce)} delta={d(bounce, prevBounce)} invert sub="Single-page sessions" />
        <Kpi label="Orders (tracked)" value={count(c.trackedOrders)} delta={change(c.trackedOrders, p.trackedOrders)} sub={`${count(c.orders)} online orders in all`} />
        <Kpi label="Conversion" value={pct(conv, 2)} delta={d(conv, prevConv)} highlight sub="Sessions that placed an order" />
        <Kpi label="Revenue" value={money(c.revenue)} delta={change(c.revenue, p.revenue)} sub="Online orders" />
        <Kpi label="Revenue / session" value={money(rps, 2)} delta={d(rps, prevRps)} />
      </KpiGrid>

      <AttentionList items={toAttention(data.attention)} />

      <Section title={`Sessions and orders by ${data.period.bucket}`}>
        <BarSeries
          rows={data.trend}
          label={r => bucketLabel(r.bucket, data.period.bucket)}
          series={[
            { key: 'sessions', label: 'Sessions', color: 'rgba(148,163,184,0.7)' },
            { key: 'orders', label: 'Online orders', color: '#84cc16' },
          ]}
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="Top sources">
          <HBars
            empty="No sessions yet"
            rows={data.topSources.map(s => ({
              key: s.channel,
              label: s.label,
              value: s.sessions,
              right: `${count(s.sessions)} · ${rateText(s.convertedSessions, s.sessions)}`,
            }))}
          />
        </Section>
        <Section title="Top landing pages">
          <HBars
            empty="No sessions yet"
            color="rgba(59,130,246,0.6)"
            rows={data.topLanding.map(l => ({
              key: l.path,
              label: l.path,
              value: l.sessions,
              right: `${count(l.sessions)} · ${rateText(l.convertedSessions, l.sessions)}`,
            }))}
          />
        </Section>
        <Section title="Top products viewed">
          <HBars
            empty="No product views yet"
            color="rgba(168,85,247,0.6)"
            rows={data.topProducts.map(t => ({
              key: t.productId,
              label: (
                <Link href={productHref(t.productId)} className="hover:text-accent-600">
                  {t.name}
                </Link>
              ),
              value: t.views,
            }))}
          />
        </Section>
      </div>
      <p className="text-xs text-foreground-muted">
        Tracked orders are those whose confirmation page the shopper opened in the session. Revenue counts every online
        order in the period that was not cancelled or left unpaid.
      </p>
    </div>
  )
}
