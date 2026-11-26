import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/lib/page-insights/stats'

export const AGENT_INSIGHTS: InsightsConfig = {
  title: 'Agent activity',
  copy: { subject: 'Agent conversations and tool calls', unit: 'events', noun: 'conversations and tool calls', empty: 'No agent activity in this range.' },
  load: insightsLoader('/api/admin/agent/insights'),
  stats: s => pageStats(s),
  sections: [weekdaySection({ title: 'Activity by weekday' }), weeklySection({ title: 'Conversations vs tool calls · weekly', half: true })],
}
