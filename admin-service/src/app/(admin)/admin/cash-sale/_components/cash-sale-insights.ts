import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const CASH_SALE_INSIGHTS: InsightsConfig = {
  title: 'Cash sales',
  copy: { subject: 'Cash sales', unit: 'sales', noun: 'cash sales', empty: 'No cash sales in this range.' },
  load: insightsLoader('/api/admin/cash-sale/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Cash sales · weekly' })],
}
