import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const SUBSCRIPTIONS_INSIGHTS: InsightsConfig = {
  title: 'Subscriptions started',
  copy: { subject: 'Subscriptions started', unit: 'subscriptions', noun: 'subscriptions started', empty: 'No subscriptions started in this range.' },
  load: insightsLoader('/api/admin/subscriptions/insights'),
  filter: { label: 'Billing', options: [{ value: 'all', label: 'All billing' }, { value: 'razorpay', label: 'Razorpay' }, { value: 'phonepe', label: 'PhonePe Autopay' }] },
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Subscriptions · weekly' })],
}
