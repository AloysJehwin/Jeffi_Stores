import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const QUOTATIONS_INSIGHTS: InsightsConfig = {
  title: 'Quotations sent',
  copy: { subject: 'Quotations sent', unit: 'quotes', noun: 'quotations sent', empty: 'No quotations sent in this range.' },
  load: insightsLoader('/api/admin/quotations/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Awaiting vs converted · weekly' })],
}
