import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesSums } from '@/lib/page-insights/stats'
import { fmtLong, nf } from '@/components/admin/dashboard/viz'

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export const AI_COSTS_INSIGHTS: InsightsConfig = {
  title: 'AI spend',
  copy: { subject: 'AI spend', unit: 'rupees', noun: 'rupees of AI usage', empty: 'No AI spend in this range.' },
  load: insightsLoader('/api/admin/financial/ai-costs/insights'),
  stats: s => {
    const sums = seriesSums(s)
    const total = sums.reduce((n, x) => n + x.total, 0)
    const top = [...sums].sort((a, b) => b.total - a.total)[0]
    const b = s.totals.busiestDay
    return [
      { label: `${s.weeks}-week spend`, value: rupees(total), accent: true },
      { label: 'Top capability', value: top && top.total > 0 ? top.label : '–', sub: top && top.total > 0 ? rupees(top.total) : undefined },
      { label: 'Busiest day', value: b ? `₹${nf(Math.round(b.count))}` : '–', sub: b ? fmtLong(b.date) : undefined },
    ]
  },
  sections: [weekdaySection({ title: 'Spend by weekday' }), weeklySection({ title: 'Spend · weekly', half: true })],
}
