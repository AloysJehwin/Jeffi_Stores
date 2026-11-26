import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/components/admin/insights-pages/stats'

export const TASKS_INSIGHTS: InsightsConfig = {
  title: 'Task flow',
  copy: { subject: 'Tasks created and completed', unit: 'tasks', noun: 'tasks created and completed', empty: 'No tasks created or completed in this range.' },
  load: insightsLoader('/api/admin/tasks/insights'),
  filter: {
    label: 'Priority',
    options: [
      { value: 'all', label: 'All priorities' },
      { value: 'urgent', label: 'Urgent' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ],
  },
  stats: s => pageStats(s, { rate: { label: 'Completion ratio', of: 1, over: 0 } }),
  sections: [weekdaySection({ title: 'Activity by weekday' }), weeklySection({ title: 'Created vs completed · weekly', half: true })],
}
