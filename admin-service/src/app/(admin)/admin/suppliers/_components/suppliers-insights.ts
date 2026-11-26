import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const SUPPLIERS_INSIGHTS: InsightsConfig = {
  title: 'Supplier activity',
  copy: { subject: 'Supplier activity', unit: 'documents', noun: 'documents', empty: 'No supplier activity in this range.' },
  load: insightsLoader('/api/admin/suppliers/insights'),
  filter: { label: 'Document', options: [{ value: 'orders', label: 'Purchase orders' }, { value: 'receipts', label: 'Goods receipts' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'open' }, { key: 'received' }, { key: 'cancelled' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Activity · weekly' })],
}
