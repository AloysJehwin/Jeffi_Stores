'use client'

import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import { PeriodBar, OverviewSkeleton, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { delta } from '@/lib/overview/period'
import { AI_CAPABILITY_LABEL, aiFeatureLabel } from '@/lib/ai/feature-labels'
import { KeyedTrendCard, MixDonutCard, type TrendPoint } from '@/components/admin/kit/charts'

type Totals = { calls: number; cost_inr: number; price_inr: number; failed: number; unpaid: number }
type Grouped = { key: string; calls: number; cost_inr: number; price_inr: number; failed: number }
type AiCosts = {
  range: { from: string; to: string }
  bucket: 'day' | 'week' | 'month'
  flagship: boolean
  current: Totals
  previous: Totals
  by_capability: Grouped[]
  by_provider: Grouped[]
  by_feature: Grouped[]
  providers: string[]
  series: TrendPoint[]
  top_refs: { ref: string; feature: string; calls: number; cost_inr: number; price_inr: number }[]
}

const PROVIDER_LABEL: Record<string, string> = { ollama: 'Razer (Ollama)', razer: 'Razer (SD)', google: 'Google', replicate: 'Replicate', openai: 'OpenAI' }
const CAP_COLOR: Record<string, string> = {
  text: 'rgb(59 130 246)',
  embed: 'rgb(100 116 139)',
  vision: 'rgb(168 85 247)',
  image: 'rgb(16 185 129)',
  video: 'rgb(234 179 8)',
}

export function AiCostsTab() {
  const [period, setPeriod] = usePeriod('30d')
  const { data, error, loading, reload } = useOverviewData<AiCosts>(`/api/admin/financial/ai-costs?from=${period.from}&to=${period.to}`)

  return (
    <div className="space-y-5">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: AiCosts }) {
  const c = d.current
  const p = d.previous
  // Flagship pays providers; tenants are charged to the wallet.
  const amt = (t: { cost_inr: number; price_inr: number }) => (d.flagship ? t.cost_inr : t.price_inr)
  const label = d.flagship ? 'Platform cost' : 'Charged to wallet'

  const cols: Col<Grouped>[] = [
    { key: 'feature', label: 'Feature', render: r => aiFeatureLabel(r.key) },
    { key: 'calls', label: 'Calls', num: true, render: r => count(r.calls) },
    { key: 'amount', label, num: true, render: r => money(amt(r), 2) },
    ...(d.flagship ? [] : [{ key: 'cost', label: 'Platform cost', num: true, render: (r: Grouped) => money(r.cost_inr, 2) }]),
    { key: 'failed', label: 'Failed', num: true, render: r => count(r.failed) },
  ]
  const refCols: Col<AiCosts['top_refs'][number]>[] = [
    { key: 'ref', label: 'Reference', render: r => <span className="font-mono text-xs">{r.ref}</span> },
    { key: 'feature', label: 'Feature', render: r => aiFeatureLabel(r.feature) },
    { key: 'calls', label: 'Calls', num: true, render: r => count(r.calls) },
    { key: 'amount', label, num: true, render: r => money(amt(r), 2) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label={label} value={money(amt(c), 2)} delta={delta(amt(c), amt(p))} invert highlight />
        <Kpi label="Calls" value={count(c.calls)} delta={delta(c.calls, p.calls)} />
        {d.flagship ? (
          <Kpi label="Tenant charges" value="-" sub="The flagship is never charged" />
        ) : (
          <Kpi label="Platform cost" value={money(c.cost_inr, 2)} sub="What the providers cost" />
        )}
        {d.by_capability.slice(0, 3).map(g => (
          <Kpi key={g.key} label={AI_CAPABILITY_LABEL[g.key] ?? g.key} value={money(amt(g), 2)} sub={`${count(g.calls)} calls`} />
        ))}
        <Kpi label="Failed" value={count(c.failed)} sub="Refunded to 0" />
        {!d.flagship && <Kpi label="Unpaid" value={count(c.unpaid)} sub="Ran with a short wallet" />}
      </KpiGrid>

      {!d.flagship && c.unpaid > 0 && (
        <Banner ok={false}>
          {count(c.unpaid)} AI calls ran while the wallet could not cover them. Top up the wallet to keep AI features running.
        </Banner>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title={`${label} by provider`}
            data={d.series}
            keys={d.providers}
            labels={PROVIDER_LABEL}
            granularity={d.bucket}
          />
        </div>
        <MixDonutCard
          title="By capability"
          segments={d.by_capability
            .filter(g => amt(g) > 0)
            .map(g => ({ label: AI_CAPABILITY_LABEL[g.key] ?? g.key, value: amt(g), color: CAP_COLOR[g.key] ?? 'rgb(148 163 184)' }))}
          total={money(amt(c))}
          totalLabel={label}
        />
      </div>

      <Section title="By feature">
        <Table rows={d.by_feature} cols={cols} rowKey={r => r.key} empty="No AI usage in this period." />
      </Section>

      <Section title="By provider">
        <Table
          rows={d.by_provider}
          cols={[{ key: 'provider', label: 'Provider', render: (r: Grouped) => PROVIDER_LABEL[r.key] ?? r.key }, ...cols.slice(1)]}
          rowKey={r => r.key}
          empty="No AI usage in this period."
        />
      </Section>

      {d.top_refs.length > 0 && (
        <Section title="Top references">
          <Table rows={d.top_refs} cols={refCols} rowKey={r => r.ref} />
        </Section>
      )}
    </div>
  )
}
