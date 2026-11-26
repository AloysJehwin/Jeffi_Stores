import { insightsLoader, weekdaySection, weeklySection, type InsightsConfig } from '@/components/admin/insights'
import { pageStats } from '@/lib/page-insights/stats'

/** The insights sheet for one Showcase: page views against the enquiries it received. */
export function showcaseInsights(siteId: string, tenantSlug: string): InsightsConfig {
  return {
    title: 'Site views and enquiries',
    copy: { subject: 'Views and enquiries', unit: 'events', noun: 'views and enquiries', empty: 'No views or enquiries in this range.' },
    load: insightsLoader(`/api/ecom/showcase/${siteId}/analytics/insights?tenant=${encodeURIComponent(tenantSlug)}`),
    stats: s => pageStats(s, { rate: { label: 'Enquiries per view', of: 1, over: 0 } }),
    sections: [weekdaySection({ title: 'Activity by weekday' }), weeklySection({ title: 'Views vs enquiries · weekly', half: true })],
  }
}
