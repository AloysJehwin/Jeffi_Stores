import { insightsLoader, weekdaySection, type InsightsConfig } from '@/components/admin/insights'
import { totalVsPartSection } from '@/components/admin/insights-pages/sections'
import { partStats } from '@/lib/page-insights/stats'

export const CAMPAIGNS_INSIGHTS: InsightsConfig = {
  title: 'Campaign sends',
  copy: { subject: 'Campaign sends', unit: 'sends', noun: 'sends', empty: 'No campaign sends in this range.' },
  load: insightsLoader('/api/admin/campaigns/insights'),
  filter: {
    label: 'Channel',
    options: [
      { value: 'all', label: 'All channels' },
      { value: 'email', label: 'Email' },
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'sms', label: 'SMS' },
      { value: 'push', label: 'App push' },
    ],
  },
  stats: s => partStats(s, { totalLabel: 'Sends', partIndex: 1, partLabel: 'Conversions', rateLabel: 'Conversion rate' }),
  sections: [weekdaySection({ title: 'Sends by weekday' }), totalVsPartSection({ title: 'Sends vs conversions · weekly', totalLabel: 'Sends', partLabel: 'Conversions', partIndex: 1, half: true })],
}
