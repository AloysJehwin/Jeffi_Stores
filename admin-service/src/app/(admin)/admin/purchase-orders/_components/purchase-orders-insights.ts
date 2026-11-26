import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const PURCHASE_ORDERS_INSIGHTS: InsightsConfig = {
  title: 'Purchase orders raised',
  copy: { subject: 'Purchase orders raised', unit: 'POs', noun: 'purchase orders', empty: 'No purchase orders in this range.' },
  load: insightsLoader('/api/admin/purchase-orders/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Purchase orders · weekly' })],
}
