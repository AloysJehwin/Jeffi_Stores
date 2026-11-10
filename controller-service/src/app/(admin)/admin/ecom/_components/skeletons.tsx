import type { ReactNode } from 'react'
import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, LoadingTable, LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { PERIOD_PRESETS } from '@/lib/overview/period'

// Loading screens for the platform's ecom pages: the list pages open on their Overview tab, so these
// mirror each overview (period bar, KPIs, sections) with real labels. Server-safe; the overviews reuse
// the bodies while their data loads.

/** The overview's period bar: presets with the default (30 days) on, the dates shimmering. */
export function PeriodBarLoading() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-control max-w-full overflow-x-auto gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg">
        {PERIOD_PRESETS.map(p => (
          <span key={p.id} className={`flex items-center px-2.5 text-xs font-medium rounded-md whitespace-nowrap ${p.id === '30d' ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs">
        <Sk className="h-control w-32 rounded-lg" />
        <span className="text-foreground-muted">to</span>
        <Sk className="h-control w-32 rounded-lg" />
      </div>
      <Sk className="h-3 w-40" />
    </div>
  )
}

/** A list page on its Overview tab: header, the two tabs, the period bar and the overview body. */
export function EcomListLoading({ title, description, listLabel, children }: { title: string; description: string; listLabel: string; children: ReactNode }) {
  return (
    <PageLoading title={title} description={description}>
      <LoadingTabs tabs={['Overview', listLabel]} active={0} />
      <div className="space-y-4">
        <PeriodBarLoading />
        {children}
      </div>
    </PageLoading>
  )
}

function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
}

function Bars({ title }: { title: string }) {
  return (
    <LoadingSection title={title}>
      <div className="space-y-3">
        {['w-full', 'w-4/5', 'w-3/5', 'w-2/5'].map(w => (
          <div key={w} className="space-y-1.5">
            <Sk className="h-3 w-24" />
            <Sk className={`h-2.5 rounded-full ${w}`} />
          </div>
        ))}
      </div>
    </LoadingSection>
  )
}

function TableSection({ title, columns, rows = 5 }: { title: string; columns: string[]; rows?: number }) {
  return (
    <LoadingSection title={title}>
      <LoadingTable columns={columns} rows={rows} bare />
    </LoadingSection>
  )
}

export function CustomersOverviewLoading() {
  return (
    <>
      <LoadingKpis labels={['Live stores', 'New signups', 'Stores gone live', 'Signup to live', 'Churned stores', 'In the funnel']} />
      <LoadingChart title="Signups" />
      <Grid2>
        <LoadingSection title="Tenants by status">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Sk className="h-36 w-36 shrink-0 rounded-full" />
            <div className="w-full">
              <LoadingLines lines={6} />
            </div>
          </div>
        </LoadingSection>
        <Bars title="Stores by plan" />
      </Grid2>
      <TableSection title="Top stores by GMV" columns={['Store', 'Plan', 'Payments', 'GMV', 'vs previous']} />
    </>
  )
}

export function BillingOverviewLoading() {
  return (
    <>
      <LoadingKpis
        labels={['MRR', 'Paying stores', 'New MRR', 'Churned MRR', 'Net new MRR', 'MRR churn', 'Subscriptions collected', 'Store GMV', 'Commission', 'Wallet top-ups', 'Messaging revenue', 'Documents revenue', 'Servers revenue']}
      />
      <LoadingChart title="Revenue over time" />
      <Grid2>
        <LoadingSection title="Subscriptions">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {Array.from({ length: 5 }).map((_, i) => <Sk key={i} className="h-14 rounded-lg last:col-span-2 sm:last:col-span-1" />)}
          </div>
        </LoadingSection>
        <Bars title="MRR by plan" />
      </Grid2>
      <TableSection title="Plans" columns={['Plan', 'Price / month', 'Paying', 'MRR', 'ARR']} rows={4} />
      <TableSection title="Renewals in the next 7 days" columns={['Store', 'Plan', 'Billing', 'Due', 'Amount']} rows={4} />
    </>
  )
}

export function InstancesOverviewLoading() {
  return (
    <>
      <LoadingKpis
        labels={['Provisioned', 'Running', 'Pooled / dedicated', 'Provisioning runs', 'Failed runs', 'Time to provision', 'Open jobs', 'Release drift', 'Release failures', 'Storage used', 'Near quota', 'Live without DB']}
      />
      <TableSection title="Unfinished provisioning jobs" columns={['Store', 'Step', 'Job', 'Attempts', 'Last error', 'Updated']} rows={3} />
      <Grid2>
        <Bars title="Failing steps this period" />
        <Bars title="Stores by region" />
      </Grid2>
      <TableSection title="Storage against plan quota" columns={['Store', 'Plan', 'Files', 'Used', 'Quota', 'Used %']} />
    </>
  )
}

export function StoreStatusOverviewLoading() {
  return (
    <>
      <LoadingKpis labels={['Up', 'Degraded', 'Down', 'Suspended', 'Setting up', 'Incidents']} />
      <LoadingSection title="Live check" lines={1} />
      <Grid2>
        <TableSection title="Stores not fully up" columns={['Store', 'Host', 'Plan', 'State']} rows={4} />
        <LoadingSection title="Domains and certificates">
          <dl className="space-y-2 text-sm">
            {['Custom domains verified', 'Custom domains pending', 'Custom domains verifying', 'Custom domains failed', 'Admin certificates active', 'Admin certificates expiring in 30 days', 'Store CAs expiring in 30 days', 'Next CA expiry'].map(l => (
              <div key={l} className="flex items-center justify-between gap-3">
                <dt className="text-foreground-secondary">{l}</dt>
                <dd><Sk className="h-3.5 w-10" /></dd>
              </div>
            ))}
          </dl>
        </LoadingSection>
      </Grid2>
      <TableSection title="Incidents in this period" columns={['When', 'Store', 'What', 'Detail']} />
    </>
  )
}
