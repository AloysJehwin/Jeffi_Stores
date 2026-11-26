import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const B2B_CUSTOMERS_INSIGHTS: InsightsConfig = {
  title: 'Business applications',
  copy: { subject: 'Business applications', unit: 'applications', noun: 'applications', empty: 'No business applications in this range.' },
  load: insightsLoader('/api/admin/business/customers/insights'),
  stats: (s, copy) => shareStats(s, copy, [{ key: 'approved' }, { key: 'pending' }, { key: 'rejected' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Approved, pending and rejected · weekly' })],
}
