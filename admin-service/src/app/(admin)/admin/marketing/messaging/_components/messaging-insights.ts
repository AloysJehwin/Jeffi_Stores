import { insightsLoader, weekdaySection, type InsightsConfig } from '@/components/admin/insights'
import { totalVsPartSection } from '@/components/admin/insights-pages/sections'
import { partStats } from '@/lib/page-insights/stats'

// Failed is the last series on every channel: email has sent + failed, WhatsApp and SMS delivered + awaiting + failed.
export const MESSAGING_INSIGHTS: InsightsConfig = {
  title: 'Messages sent',
  copy: { subject: 'Messages sent', unit: 'messages', noun: 'messages', empty: 'No messages in this range.' },
  load: insightsLoader('/api/admin/marketing/messaging/insights'),
  filter: {
    label: 'Channel',
    options: [
      { value: 'whatsapp', label: 'WhatsApp' },
      { value: 'sms', label: 'SMS' },
      { value: 'email', label: 'Email broadcasts' },
    ],
  },
  stats: s => partStats(s, { totalLabel: 'Messages', partIndex: s.series.length - 1, partLabel: 'Failed', rateLabel: 'Failure rate' }),
  sections: [weekdaySection({ title: 'Messages by weekday' }), totalVsPartSection({ title: 'Messages vs failures · weekly', totalLabel: 'Messages', partLabel: 'Failed', partIndex: -1, half: true })],
}
