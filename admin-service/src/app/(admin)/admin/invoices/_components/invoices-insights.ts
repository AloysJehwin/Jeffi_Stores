import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const INVOICES_INSIGHTS: InsightsConfig = {
  title: 'Invoices issued',
  copy: { subject: 'Invoiced value', unit: 'INR', noun: 'invoiced (INR)', empty: 'No invoices in this range.' },
  load: insightsLoader('/api/admin/invoices/insights'),
  filter: { label: 'Buyer', options: [{ value: 'all', label: 'All buyers' }, { value: 'b2b', label: 'Business (GSTIN)' }, { value: 'b2c', label: 'Consumers' }] },
  stats: seriesStats({ money: true }),
  sections: [weekdaySection(), weeklySection({ title: 'Invoiced value · weekly' })],
}
