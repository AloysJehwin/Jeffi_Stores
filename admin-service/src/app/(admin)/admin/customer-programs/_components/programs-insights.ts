import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { shareStats } from '@admin/app/(admin)/admin/_insights/stats'

export const PROGRAMS_INSIGHTS: InsightsConfig = {
  title: 'Program activity',
  copy: { subject: 'Program activity', unit: 'events', noun: 'events', empty: 'No program activity in this range.' },
  load: insightsLoader('/api/admin/customer-programs/insights'),
  filter: { label: 'Program', options: [{ value: 'loyalty', label: 'Loyalty points' }, { value: 'referrals', label: 'Referral sign-ups' }] },
  stats: (s, copy) => shareStats(s, copy, [{ key: 'earned' }, { key: 'redeemed' }, { key: 'reversed' }, { key: 'joined' }, { key: 'rewarded' }]),
  sections: [weekdaySection(), weeklySection({ title: 'Activity · weekly' })],
}
