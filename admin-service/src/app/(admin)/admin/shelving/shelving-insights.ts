import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const SHELVING_INSIGHTS: InsightsConfig = {
  title: 'Shelf movements',
  copy: { subject: 'Shelf movements', unit: 'movements', noun: 'movements', empty: 'No shelf movements in this range.' },
  load: insightsLoader('/api/admin/shelving/insights'),
  stats: (s, copy) => shareStats(s, copy, [{ key: 'added' }, { key: 'removed' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Added and removed · weekly' })],
}
