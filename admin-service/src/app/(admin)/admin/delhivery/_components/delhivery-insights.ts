import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const DELHIVERY_INSIGHTS: InsightsConfig = {
  title: 'Delhivery shipments',
  copy: { subject: 'Shipments', unit: 'shipments', noun: 'shipments', empty: 'No shipments in this range.' },
  load: insightsLoader('/api/admin/delhivery/insights'),
  filter: { label: 'Status', options: [{ value: 'all', label: 'All shipments' }, { value: 'in_transit', label: 'In transit' }, { value: 'delivered', label: 'Delivered' }, { value: 'rto', label: 'Returned (RTO)' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'delivered' }, { key: 'in_transit' }, { key: 'rto' }]),
  sections: [weekdaySection(), weeklySection({ title: 'By delivery state · weekly' })],
}
