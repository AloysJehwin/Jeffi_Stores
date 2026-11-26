import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/lib/page-insights/stats'

export const AUDIT_INSIGHTS: InsightsConfig = {
  title: 'Audit events',
  copy: { subject: 'Audit events', unit: 'events', noun: 'events', empty: 'No audit events in this range.' },
  load: insightsLoader('/api/admin/audit/insights'),
  filter: {
    label: 'Action',
    options: [
      { value: 'all', label: 'All actions' },
      { value: 'risky', label: 'Risky (delete, import, export)' },
      { value: 'create', label: 'Creates' },
      { value: 'update', label: 'Updates' },
    ],
  },
  stats: s => pageStats(s),
  sections: [weekdaySection({ title: 'Events by weekday' }), weeklySection({ title: 'Team vs system · weekly', half: true })],
}
