import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const REPLACEMENTS_INSIGHTS: InsightsConfig = {
  title: 'Replacement requests',
  copy: { subject: 'Replacement requests', unit: 'requests', noun: 'replacement requests', empty: 'No replacement requests in this range.' },
  load: insightsLoader('/api/admin/replacements/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Replacement requests · weekly' })],
}
