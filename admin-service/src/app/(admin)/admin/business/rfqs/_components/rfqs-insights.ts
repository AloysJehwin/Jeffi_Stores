import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const RFQS_INSIGHTS: InsightsConfig = {
  title: 'RFQs received',
  copy: { subject: 'RFQs received', unit: 'RFQs', noun: 'RFQs', empty: 'No RFQs in this range.' },
  load: insightsLoader('/api/admin/business/rfqs/insights'),
  stats: (s, copy) => shareStats(s, copy, [{ key: 'converted' }, { key: 'pending' }, { key: 'rejected' }]),
  sections: [weekdaySection(), weeklySection({ title: 'RFQs by stage · weekly' })],
}
