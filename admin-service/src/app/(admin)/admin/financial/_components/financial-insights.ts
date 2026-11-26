import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const FINANCE_INSIGHTS: InsightsConfig = {
  title: 'Revenue and refunds',
  copy: { subject: 'Revenue and refunds', unit: 'INR', noun: 'revenue + refunds (INR)', empty: 'No sales in this range.' },
  load: insightsLoader('/api/admin/financial/insights'),
  filter: { label: 'Channel', options: [{ value: 'all', label: 'All channels' }, { value: 'online', label: 'Online store' }, { value: 'business', label: 'Business' }, { value: 'offline', label: 'Offline' }] },
  stats: seriesStats({ money: true }),
  sections: [weeklySection({ title: 'Revenue vs refunds · weekly', half: false })],
}
