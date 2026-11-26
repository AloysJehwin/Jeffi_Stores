import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const ORDERS_INSIGHTS: InsightsConfig = {
  title: 'Orders placed',
  copy: { subject: 'Orders placed', unit: 'orders', noun: 'orders placed', empty: 'No orders in this range.' },
  load: insightsLoader('/api/admin/orders/insights'),
  filter: { label: 'Channel', options: [{ value: 'all', label: 'All channels' }, { value: 'online', label: 'Online store' }, { value: 'cod', label: 'Cash on delivery' }, { value: 'business', label: 'Business' }] },
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Orders · weekly' })],
}
