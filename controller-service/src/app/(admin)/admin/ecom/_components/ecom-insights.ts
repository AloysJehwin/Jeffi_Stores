import { insightsLoader, weekdaySection, type InsightsConfig } from '@/components/admin/insights'
import { totalVsPartSection } from '@/components/admin/insights-pages/sections'
import { partStats } from '@/components/admin/insights-pages/stats'

const BASE = '/api/admin/ecom'

export const ECOM_CUSTOMERS_INSIGHTS: InsightsConfig = {
  title: 'Workspace signups',
  copy: { subject: 'Workspace signups', unit: 'signups', noun: 'signups', empty: 'No signups in this range.' },
  load: insightsLoader(`${BASE}/customers/insights`),
  filter: {
    label: 'Product',
    options: [
      { value: 'all', label: 'All products' },
      { value: 'store', label: 'Stores' },
      { value: 'services', label: 'Services' },
    ],
  },
  stats: s => partStats(s, { totalLabel: 'Signups', partIndex: 1, partLabel: 'Went live', rateLabel: 'Activation rate' }),
  sections: [weekdaySection({ title: 'Signups by weekday' }), totalVsPartSection({ title: 'Signups vs went live · weekly', totalLabel: 'Signups', partLabel: 'Went live', partIndex: 1, half: true })],
}

export const ECOM_INSTANCES_INSIGHTS: InsightsConfig = {
  title: 'Provisioning outcomes',
  copy: { subject: 'Provisioning jobs finished', unit: 'jobs', noun: 'provisioning jobs', empty: 'No provisioning jobs finished in this range.' },
  load: insightsLoader(`${BASE}/instances/insights`),
  stats: s => partStats(s, { totalLabel: 'Jobs finished', partIndex: 1, partLabel: 'Failed', rateLabel: 'Failure rate' }),
  sections: [weekdaySection({ title: 'Jobs by weekday' }), totalVsPartSection({ title: 'Finished vs failed · weekly', totalLabel: 'Finished', partLabel: 'Failed', partIndex: 1, half: true })],
}

export const ECOM_STORE_STATUS_INSIGHTS: InsightsConfig = {
  title: 'Store health events',
  copy: { subject: 'Store health events', unit: 'events', noun: 'release runs or provisioning steps', empty: 'No events in this range.' },
  load: insightsLoader(`${BASE}/store-status/insights`),
  filter: {
    label: 'Events',
    options: [
      { value: 'releases', label: 'Release runs' },
      { value: 'provisioning', label: 'Provisioning steps' },
    ],
  },
  stats: s => partStats(s, { totalLabel: 'Events', partIndex: 1, partLabel: 'Failed', rateLabel: 'Failure rate' }),
  sections: [weekdaySection({ title: 'Events by weekday' }), totalVsPartSection({ title: 'Events vs failures · weekly', totalLabel: 'Events', partLabel: 'Failed', partIndex: 1, half: true })],
}

export const ECOM_BILLING_INSIGHTS: InsightsConfig = {
  title: 'Subscription charges',
  copy: { subject: 'Subscription charges', unit: 'charges', noun: 'charges', empty: 'No charges in this range.' },
  load: insightsLoader(`${BASE}/billing/insights`),
  stats: s => partStats(s, { totalLabel: 'Charges', partIndex: 1, partLabel: 'Refunded', rateLabel: 'Refund rate' }),
  sections: [weekdaySection({ title: 'Charges by weekday' }), totalVsPartSection({ title: 'Charges vs refunded · weekly', totalLabel: 'Charges', partLabel: 'Refunded', partIndex: 1, half: true })],
}
