import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/components/admin/insights-pages/stats'

export const TRAFFIC_INSIGHTS: InsightsConfig = {
  title: 'Store traffic',
  copy: { subject: 'Page views and sessions', unit: 'visits', noun: 'page views and sessions', empty: 'No visits in this range.' },
  load: insightsLoader('/api/admin/traffic/insights'),
  filter: {
    label: 'Page',
    options: [
      { value: 'all', label: 'All pages' },
      { value: 'product', label: 'Product pages' },
      { value: 'cart', label: 'Cart' },
      { value: 'checkout', label: 'Checkout' },
    ],
  },
  stats: s => pageStats(s),
  sections: [weekdaySection({ title: 'Visits by weekday' }), weeklySection({ title: 'Page views vs sessions · weekly', half: true })],
}
