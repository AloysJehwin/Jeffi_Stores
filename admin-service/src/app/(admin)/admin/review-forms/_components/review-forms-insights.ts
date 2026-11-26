import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const REVIEW_FORMS_INSIGHTS: InsightsConfig = {
  title: 'Review form responses',
  copy: { subject: 'Review form responses', unit: 'responses', noun: 'responses', empty: 'No responses in this range.' },
  load: insightsLoader('/api/admin/review-forms/insights'),
  stats: (s, copy) => shareStats(s, copy, [{ key: 'approved' }, { key: 'pending' }, { key: 'rejected' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Responses by status · weekly' })],
}
