'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Star } from 'lucide-react'
import { Kpi, KpiGrid, Section, Badge, Banner, Empty, api, count, pct, change } from '@/components/admin/channels/ui'
import { TrendChart, type ChartPoint, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import {
  PERIOD_PRESETS,
  istToday,
  matchPreset,
  parsePeriod,
  presetRange,
  runningAverage,
  type Period,
} from '@/lib/reviews/overview-period'

interface Stats {
  reviews: number
  avgRating: number | null
  positive: number
  negative: number
  withPhotos: number
  verified: number
  approved: number
}
interface ProductRow {
  id: string
  name: string
  slug: string | null
  reviews: number
  avgRating: number | null
  newReviews: number
  negative?: number
}
interface Funnel {
  messages: number
  emails: number
  otherChannels: number
  orders: number
  opened: number
  clicked: number
  reviewed: number
}
interface FormsStats {
  submissions: number
  coupons: number
  pending: number
}
export interface ReviewsOverviewData {
  period: Period
  previous: Period
  kpis: { current: Stats; previous: Stats }
  pending: { count: number; negative: number; oldest: string | null }
  allTime: { reviews: number; avgRating: number | null }
  distribution: { rating: number; count: number }[]
  trend: { day: string; reviews: number; negative: number; avgRating: number | null }[]
  products: {
    minReviews: number
    top: ProductRow[]
    lowest: ProductRow[]
    mostNegative: ProductRow[]
    ratingDrops: { id: string; name: string; slug: string | null; beforeAvg: number | null; afterAvg: number | null; newAvg: number | null; newReviews: number }[]
  }
  recentNegative: {
    id: string
    rating: number
    title: string | null
    comment: string
    createdAt: string
    isApproved: boolean
    verified: boolean
    productId: string | null
    productName: string | null
    customer: string | null
  }[]
  funnel: { current: Funnel; previous: Funnel }
  forms: { current: FormsStats; previous: FormsStats; pendingByForm: { id: string; title: string; pending: number }[] } | null
}

const ratio = (a: number, b: number) => (b ? a / b : null)
const rating = (v: number | null | undefined) => (v == null ? '-' : v.toFixed(2))
const ratingDelta = (cur: number | null, prev: number | null) => (cur != null && prev ? (cur - prev) / prev : null)
const ageDays = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0)
const listHref = (filter: string, q?: string) =>
  ap(`/admin/reviews?view=reviews&filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`)

const TREND_SERIES: SeriesDef[] = [
  { key: 'reviews', label: 'Reviews', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count', on: true },
  { key: 'negative', label: '1-2 star', color: 'rgb(239 68 68)', kind: 'line', axis: 'count', on: true },
]
const RATING_SERIES: SeriesDef[] = [
  { key: 'avg', label: 'Average rating (running)', color: 'rgb(234 179 8)', kind: 'line', axis: 'count', on: true },
  { key: 'daily', label: 'Daily average', color: 'rgb(59 130 246)', kind: 'line', axis: 'count', on: false },
]
const BAR_TONE: Record<number, string> = {
  5: 'bg-green-500',
  4: 'bg-green-400',
  3: 'bg-amber-400',
  2: 'bg-orange-500',
  1: 'bg-red-500',
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const today = istToday()
  const active = matchPreset(value, today)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(presetRange(p.id, today))}
            className={`h-full px-2.5 text-xs font-medium rounded-md whitespace-nowrap ${
              active === p.id ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span aria-label="From">
          <DatePicker aria-label="From" value={value.from} max={value.to} onChange={v => v && onChange({ ...value, from: v })} />
        </span>
        <span className="text-xs text-foreground-muted">to</span>
        <span aria-label="To">
          <DatePicker aria-label="To" value={value.to} min={value.from} max={today} onChange={v => v && onChange({ ...value, to: v })} />
        </span>
      </div>
    </div>
  )
}

function Distribution({ rows, total }: { rows: { rating: number; count: number }[]; total: number }) {
  return (
    <div className="space-y-2.5">
      {[...rows].reverse().map(r => {
        const share = total ? r.count / total : 0
        return (
          <div key={r.rating} className="flex items-center gap-3 text-xs">
            <span className="w-8 shrink-0 flex items-center gap-0.5 text-foreground-secondary tabular-nums">
              {r.rating}
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            </span>
            <div className="flex-1 h-2.5 bg-surface-secondary rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${BAR_TONE[r.rating]}`} style={{ width: `${share ? Math.max(2, share * 100) : 0}%` }} />
            </div>
            <span className="w-20 text-right shrink-0 tabular-nums text-foreground">
              {count(r.count)} <span className="text-foreground-muted">({pct(share, 0)})</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ProductList({ rows, empty, metric }: { rows: ProductRow[]; empty: string; metric: (r: ProductRow) => React.ReactNode }) {
  if (!rows.length) return <Empty msg={empty} />
  return (
    <ul className="divide-y divide-border-default/60">
      {rows.map(r => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <Link href={ap(`/admin/products/${r.id}`)} className="min-w-0 truncate text-foreground hover:text-accent-500">
            {r.name}
          </Link>
          <span className="shrink-0 text-xs text-foreground-secondary tabular-nums">{metric(r)}</span>
        </li>
      ))}
    </ul>
  )
}

function FunnelStep({ label, value, base, sub }: { label: string; value: number; base: number; sub?: string }) {
  const share = ratio(value, base)
  return (
    <div className="flex-1 min-w-[8rem] rounded-lg border border-border-default bg-surface p-3">
      <p className="text-xs text-foreground-muted">{label}</p>
      <p className="text-lg font-bold tabular-nums text-foreground">{count(value)}</p>
      <div className="mt-1.5 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
        <div className="h-full bg-accent-500 rounded-full" style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-foreground-muted">{sub ?? (base ? `${pct(share)} of asked` : '-')}</p>
    </div>
  )
}

interface Attention {
  key: string
  tone: 'red' | 'amber' | 'blue'
  title: string
  detail?: string
  href: string
  action: string
}

function buildAttention(d: ReviewsOverviewData): Attention[] {
  const items: Attention[] = []
  if (d.pending.count) {
    const age = ageDays(d.pending.oldest)
    items.push({
      key: 'pending',
      tone: age > 3 ? 'red' : 'amber',
      title: `${count(d.pending.count)} review${d.pending.count === 1 ? '' : 's'} awaiting moderation`,
      detail: `${d.pending.negative ? `${count(d.pending.negative)} of them 1-2 star. ` : ''}Oldest waiting ${age} day${age === 1 ? '' : 's'}.`,
      href: listHref('pending'),
      action: 'Moderate',
    })
  }
  for (const r of d.recentNegative) {
    items.push({
      key: `neg-${r.id}`,
      tone: 'red',
      title: `${r.rating} star on ${r.productName ?? 'a product'}${r.customer ? ` from ${r.customer}` : ''}`,
      detail: `${r.title ? `${r.title}: ` : ''}${r.comment}`.slice(0, 160),
      href: listHref(r.isApproved ? 'approved' : 'pending', r.productName ?? undefined),
      action: r.isApproved ? 'View' : 'Moderate',
    })
  }
  for (const p of d.products.ratingDrops) {
    items.push({
      key: `drop-${p.id}`,
      tone: 'amber',
      title: `${p.name} rating fell ${rating(p.beforeAvg)} to ${rating(p.afterAvg)}`,
      detail: `${count(p.newReviews)} new review${p.newReviews === 1 ? '' : 's'} averaging ${rating(p.newAvg)} this period.`,
      href: ap(`/admin/products/${p.id}`),
      action: 'Open product',
    })
  }
  for (const f of d.forms?.pendingByForm ?? []) {
    items.push({
      key: `form-${f.id}`,
      tone: 'blue',
      title: `${count(f.pending)} Google review submission${f.pending === 1 ? '' : 's'} to verify`,
      detail: f.title,
      href: ap(`/admin/review-forms/${f.id}/submissions`),
      action: 'Verify',
    })
  }
  return items
}

export default function ReviewsOverview() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const period = useMemo(
    () => parsePeriod(searchParams.get('from'), searchParams.get('to'), istToday()),
    [searchParams]
  )
  const [data, setData] = useState<ReviewsOverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const setPeriod = useCallback(
    (p: Period) => {
      const q = new URLSearchParams(window.location.search)
      q.set('from', p.from)
      q.set('to', p.to)
      router.replace(`${ap('/admin/reviews')}?${q.toString()}`, { scroll: false })
    },
    [router]
  )

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    api<ReviewsOverviewData>(`/api/admin/reviews/overview?from=${period.from}&to=${period.to}`).then(r => {
      if (!live) return
      if (r.ok) setData(r.data)
      else setError(r.data.error || 'Could not load the overview')
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [period.from, period.to])

  const trendPoints = useMemo<ChartPoint[]>(() => (data?.trend ?? []).map(t => ({ label: t.day, reviews: t.reviews, negative: t.negative })), [data])
  const ratingPoints = useMemo<ChartPoint[]>(() => {
    const t = data?.trend ?? []
    const run = runningAverage(t)
    return t.map((d, i) => ({ label: d.day, avg: run[i] ?? 0, daily: d.avgRating ?? 0 }))
  }, [data])

  const header = <PeriodPicker value={period} onChange={setPeriod} />

  if (error) return <div className="space-y-4">{header}<Banner ok={false}>{error}</Banner></div>
  if (!data) {
    return (
      <div className="space-y-4">
        {header}
        <KpiGrid>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-elevated border border-border-default animate-pulse" />
          ))}
        </KpiGrid>
      </div>
    )
  }

  const cur = data.kpis.current
  const prev = data.kpis.previous
  const posShare = ratio(cur.positive, cur.reviews)
  const negShare = ratio(cur.negative, cur.reviews)
  const prevPos = ratio(prev.positive, prev.reviews)
  const prevNeg = ratio(prev.negative, prev.reviews)
  const shareDelta = (a: number | null, b: number | null) => (a != null && b ? (a - b) / b : null)
  const f = data.funnel.current
  const fp = data.funnel.previous
  const conv = ratio(f.reviewed, f.orders)
  const attention = buildAttention(data)

  return (
    <div className={`space-y-5 ${loading ? 'opacity-70 transition-opacity' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {header}
        <p className="text-xs text-foreground-muted">
          vs {data.previous.from} to {data.previous.to}. Store rating {rating(data.allTime.avgRating)} from {count(data.allTime.reviews)} published reviews.
        </p>
      </div>

      <KpiGrid>
        <Kpi label="New reviews" value={count(cur.reviews)} delta={change(cur.reviews, prev.reviews)} sub={`${count(cur.verified)} verified purchases`} />
        <Kpi label="Average rating" value={rating(cur.avgRating)} delta={ratingDelta(cur.avgRating, prev.avgRating)} highlight />
        <Kpi label="4-5 star" value={pct(posShare)} delta={shareDelta(posShare, prevPos)} sub={`${count(cur.positive)} reviews`} />
        <Kpi label="1-2 star" value={pct(negShare)} delta={shareDelta(negShare, prevNeg)} invert sub={`${count(cur.negative)} reviews`} />
        <Kpi label="With photos" value={count(cur.withPhotos)} delta={change(cur.withPhotos, prev.withPhotos)} sub={`${pct(ratio(cur.withPhotos, cur.reviews))} of reviews`} />
        <Kpi
          label="Pending moderation"
          value={count(data.pending.count)}
          sub={data.pending.count ? `oldest ${ageDays(data.pending.oldest)}d, ${count(data.pending.negative)} are 1-2 star` : 'All caught up'}
        />
      </KpiGrid>

      <Section
        title="Needs attention"
        action={attention.length ? <Badge tone="amber">{attention.length}</Badge> : undefined}
      >
        {attention.length ? (
          <ul className="divide-y divide-border-default/60">
            {attention.map(a => (
              <li key={a.key} className="flex items-start gap-3 py-2.5">
                <AlertTriangle
                  className={`w-4 h-4 mt-0.5 shrink-0 ${a.tone === 'red' ? 'text-red-500' : a.tone === 'amber' ? 'text-amber-500' : 'text-blue-500'}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{a.title}</p>
                  {a.detail && <p className="text-xs text-foreground-secondary line-clamp-2">{a.detail}</p>}
                </div>
                <Link href={a.href} className="shrink-0 text-xs font-medium text-accent-500 hover:underline whitespace-nowrap">
                  {a.action}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty msg="Nothing needs attention in this period." />
        )}
        <p className="mt-3 text-[11px] text-foreground-muted">
          Replies to reviews are not stored yet, so 1-2 star reviews are listed for follow-up with the customer.
        </p>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="Reviews per day">
            <TrendChart points={trendPoints} series={TREND_SERIES} height={220} ariaLabel="Reviews per day" />
          </Section>
        </div>
        <Section title="Rating distribution">
          {cur.reviews ? <Distribution rows={data.distribution} total={cur.reviews} /> : <Empty msg="No reviews in this period." />}
        </Section>
      </div>

      <Section title="Average rating trend">
        {cur.reviews ? (
          <TrendChart points={ratingPoints} series={RATING_SERIES} height={180} ariaLabel="Average rating over the period" />
        ) : (
          <Empty msg="No reviews in this period." />
        )}
      </Section>

      <Section
        title="Review requests"
        action={
          <Link href={ap('/admin/campaigns')} className="text-xs text-accent-500 hover:underline">
            Campaigns
          </Link>
        }
      >
        {f.orders ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <FunnelStep label="Orders asked" value={f.orders} base={f.orders} sub={`${count(f.messages)} messages (${count(f.emails)} email)`} />
              <FunnelStep label="Opened" value={f.opened} base={f.orders} />
              <FunnelStep label="Clicked" value={f.clicked} base={f.orders} />
              <FunnelStep label="Reviewed" value={f.reviewed} base={f.orders} />
            </div>
            <p className="text-xs text-foreground-muted">
              Conversion {pct(conv)}
              {fp.orders ? ` (previous ${pct(ratio(fp.reviewed, fp.orders))} of ${count(fp.orders)} orders)` : ''}. Opens and clicks are tracked for email only.
            </p>
          </div>
        ) : (
          <Empty msg="No review requests were sent in this period. Check that the Review Request campaign is enabled." />
        )}
        {data.forms && (
          <div className="mt-4 pt-4 border-t border-border-default grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Kpi
              label="Google review submissions"
              value={count(data.forms.current.submissions)}
              delta={change(data.forms.current.submissions, data.forms.previous.submissions)}
            />
            <Kpi
              label="Review coupons issued"
              value={count(data.forms.current.coupons)}
              delta={change(data.forms.current.coupons, data.forms.previous.coupons)}
            />
            <Kpi label="Waiting verification" value={count(data.forms.current.pending)} sub="submitted this period" />
          </div>
        )}
      </Section>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Top rated products">
          <ProductList
            rows={data.products.top}
            empty={`No product has ${data.products.minReviews}+ reviews yet.`}
            metric={r => `${rating(r.avgRating)} from ${count(r.reviews)}`}
          />
        </Section>
        <Section title="Lowest rated products">
          <ProductList
            rows={data.products.lowest}
            empty={`No product has ${data.products.minReviews}+ reviews yet.`}
            metric={r => `${rating(r.avgRating)} from ${count(r.reviews)}`}
          />
        </Section>
        <Section title="Most new 1-2 star reviews">
          <ProductList
            rows={data.products.mostNegative}
            empty="No 1-2 star reviews in this period."
            metric={r => `${count(r.negative ?? 0)} of ${count(r.reviews)} new`}
          />
        </Section>
      </div>
      <p className="text-[11px] text-foreground-muted">
        Product ratings use every review up to {data.period.to} (published and pending), minimum {data.products.minReviews} reviews.
      </p>
    </div>
  )
}
