import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const CUSTOMERS_INSIGHTS: InsightsConfig = {
  title: 'Customer sign-ups',
  copy: { subject: 'New customers', unit: 'new', noun: 'customers', empty: 'No new customers in this range.' },
  load: insightsLoader('/api/admin/customers/insights'),
  filter: { label: 'Sign-in method', options: [{ value: 'all', label: 'All methods' }, { value: 'email', label: 'Email' }, { value: 'google', label: 'Google' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'accounts' }, { key: 'guests' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Accounts and guests · weekly' })],
}
