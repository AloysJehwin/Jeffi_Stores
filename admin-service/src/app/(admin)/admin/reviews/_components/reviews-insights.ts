import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const REVIEWS_INSIGHTS: InsightsConfig = {
  title: 'Reviews received',
  copy: { subject: 'Reviews received', unit: 'reviews', noun: 'reviews', empty: 'No reviews in this range.' },
  load: insightsLoader('/api/admin/reviews/insights'),
  filter: { label: 'Reviews', options: [{ value: 'all', label: 'All reviews' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }, { value: 'verified', label: 'Verified purchases' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'positive' }, { key: 'neutral' }, { key: 'critical' }]),
  sections: [weekdaySection(), weeklySection({ title: 'By rating band · weekly' })],
}
