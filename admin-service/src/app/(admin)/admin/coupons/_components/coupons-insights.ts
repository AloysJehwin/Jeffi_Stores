import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { seriesStats } from '../../_insights/stats'

export const COUPONS_INSIGHTS: InsightsConfig = {
  title: 'Coupon redemptions',
  copy: { subject: 'Coupon redemptions', unit: 'redemptions', noun: 'redemptions', empty: 'No coupon redemptions in this range.' },
  load: insightsLoader('/api/admin/coupons/insights'),
  stats: seriesStats(),
  sections: [weekdaySection(), weeklySection({ title: 'Redemptions · weekly' })],
}
