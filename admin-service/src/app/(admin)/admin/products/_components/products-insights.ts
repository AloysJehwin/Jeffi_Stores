import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const PRODUCTS_INSIGHTS: InsightsConfig = {
  title: 'Products added',
  copy: { subject: 'Products added', unit: 'added', noun: 'products', empty: 'No products were added in this range.' },
  load: insightsLoader('/api/admin/products/insights'),
  filter: { label: 'Catalogue', options: [{ value: 'all', label: 'All products' }, { value: 'simple', label: 'Simple products' }, { value: 'variants', label: 'With variants' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'live' }, { key: 'draft' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Live, drafts and inactive · weekly' })],
}
