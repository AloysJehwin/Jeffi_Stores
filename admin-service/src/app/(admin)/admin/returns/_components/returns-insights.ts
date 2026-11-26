import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const RETURNS_INSIGHTS: InsightsConfig = {
  title: 'Return requests',
  copy: { subject: 'Return requests', unit: 'requests', noun: 'return requests', empty: 'No return requests in this range.' },
  load: insightsLoader('/api/admin/returns/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Return requests · weekly' })],
}
