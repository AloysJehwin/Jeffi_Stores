import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/components/admin/insights-pages/stats'

export const TEAM_INSIGHTS: InsightsConfig = {
  title: 'Team activity',
  copy: { subject: 'Team sign-ins and actions', unit: 'events', noun: 'sign-ins and actions', empty: 'No team activity in this range.' },
  load: insightsLoader('/api/admin/team/insights'),
  stats: s => pageStats(s),
  sections: [weekdaySection({ title: 'Activity by weekday' }), weeklySection({ title: 'Members vs actions · weekly', half: true })],
}
