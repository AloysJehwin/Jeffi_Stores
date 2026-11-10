import type { ReactNode } from 'react'
import { LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import type { DetailSection } from '@controller/components/admin/ecom/detail/labels'

// Loading screens for the four tenant detail pages (Store, Instance, Status, Billing): the shared header with
// that page's KPI labels, then section bodies with their real titles and field labels. Server-safe.

const KPIS: Record<DetailSection, string[]> = {
  store: ['Status', 'Plan', 'Price / mo', 'This month'],
  instance: ['Servers', 'Pods', 'AWS / mo', 'Infra rate'],
  status: ['Status', 'Serving', 'Provisioning', 'Review'],
  billing: ['Price / mo', 'AWS / mo', 'Margin / mo', 'Wallet'],
}

/** TenantObjectHeader: back link, the store's name and status, host, ids, actions, then the page's KPI tiles. */
export function TenantDetailLoading({ back, section, children }: { back: string; section: DetailSection; children: ReactNode }) {
  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-full min-w-0 overflow-x-hidden" role="status" aria-busy="true" aria-label="Loading">
      <div className="space-y-4 min-w-0">
        <header className="space-y-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
            <span aria-hidden>&lsaquo;</span> {back}
          </span>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Sk className="my-1 h-7 w-56 max-w-full" />
                <Sk className="h-5 w-16 rounded-full" />
              </div>
              <Sk className="mt-1.5 h-3.5 w-48 max-w-full" />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-muted">
                <span className="inline-flex items-center gap-1">
                  Slug <Sk className="h-3 w-20" />
                </span>
                <span className="inline-flex items-center gap-1">
                  ID <Sk className="h-3 w-48" />
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Sk className="h-control w-24 rounded-lg" />
              <Sk className="h-control w-28 rounded-lg" />
            </div>
          </div>
        </header>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {KPIS[section].map(l => (
            <div key={l} className="rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium truncate">{l}</p>
              <Sk className="mt-1.5 h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">{children}</div>
}

/** FieldGrid with real labels; `wide` labels span both columns. */
export function FieldsLoading({ labels, wide = [] }: { labels: string[]; wide?: string[] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
      {labels.map((l, i) => (
        <div key={l} className={wide.includes(l) ? 'col-span-full sm:col-span-2' : undefined}>
          <dt className="text-xs text-foreground-muted">{l}</dt>
          <dd className="mt-1">
            <Sk className={`h-3.5 ${wide.includes(l) ? 'w-64 max-w-full' : i % 2 ? 'w-24' : 'w-32'}`} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FieldsSection({ title, labels, wide }: { title: string; labels: string[]; wide?: string[] }) {
  return (
    <LoadingSection title={title}>
      <FieldsLoading labels={labels} wide={wide} />
    </LoadingSection>
  )
}

/** The status banner above a store's overview and health. */
export function BannerLoading() {
  return (
    <div className="rounded-xl border border-border-default p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <Sk className="h-5 w-16 rounded-full" />
        <Sk className="h-3.5 w-64 max-w-full" />
      </div>
    </div>
  )
}

function ListRows({ widths, right = 'w-16' }: { widths: string[]; right?: string }) {
  return (
    <ul className="divide-y divide-border-default rounded-lg border border-border-default">
      {widths.map(w => (
        <li key={w} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <Sk className={`h-3 ${w}`} />
          <Sk className={`h-3 ${right}`} />
        </li>
      ))}
    </ul>
  )
}

export function RunningNowLoading() {
  return (
    <LoadingSection title="Running now">
      <div className="space-y-4 min-w-0">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {['Now', 'Placement', 'Servers'].map(l => (
            <div key={l} className="min-w-0">
              <dt className="text-xs text-foreground-muted">{l}</dt>
              <dd className="mt-1">
                <Sk className="h-3.5 w-24" />
              </dd>
            </div>
          ))}
        </dl>
        <ListRows widths={['w-40', 'w-32', 'w-36']} />
      </div>
    </LoadingSection>
  )
}

export function SurfacesLoading() {
  return (
    <LoadingSection title="Surfaces">
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {['w-44', 'w-52', 'w-56', 'w-48'].map(w => (
          <li key={w} className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-foreground-muted" />
            <Sk className={`h-3 ${w} max-w-full`} />
          </li>
        ))}
      </ul>
    </LoadingSection>
  )
}

function OwnersLoading() {
  return (
    <LoadingSection title="Owners">
      <ul className="space-y-3">
        {['w-48', 'w-40'].map(w => (
          <li key={w} className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <Sk className={`h-3.5 ${w}`} />
              <Sk className="h-3 w-36" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Sk className="h-3 w-12" />
              <Sk className="h-3 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingSection>
  )
}

/** The Store page's Overview tab. */
export function OverviewTabLoading() {
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <BannerLoading />
      <DetailGrid>
        <RunningNowLoading />
        <FieldsSection title="Cost" labels={['Price / month', 'Infra rate', 'AWS / month', 'Margin / month', 'This month so far', 'Compute']} />
      </DetailGrid>
      <DetailGrid>
        <FieldsSection title="Store" labels={['Subdomain', 'Custom domain', 'Plan', 'Plan fee', 'Billing', 'Payout', 'Subscription', 'Created']} />
        <FieldsSection
          title="Health"
          labels={['Instance state', 'Database', 'EC2 target', 'Region', 'Last job', 'Last change', 'Notification email']}
          wide={['Notification email']}
        />
      </DetailGrid>
      <OwnersLoading />
      <SurfacesLoading />
    </div>
  )
}

/** HealthSummary: its banner and the Health fields. */
export function HealthLoading() {
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <BannerLoading />
      <FieldsSection title="Health" labels={['Serving', 'Pods', 'Database', 'Compute', 'Instance state', 'Last job', 'Last change', 'Worker ticks']} />
    </div>
  )
}

/** InfrastructureTab: the Instance page's body and the Store page's Infrastructure tab. */
export function InfrastructureLoading() {
  return (
    <div className="space-y-5 sm:space-y-6 min-w-0">
      <LoadingSection title="Servers">
        <LoadingTable columns={['Instance', 'Name', 'Type', 'State', 'Zone', 'Launched']} rows={2} bare />
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {['Target', 'Instance id (infra)', 'Instance state'].map((l, i) => (
            <div key={l}>
              {i === 0 ? <Sk className="h-3 w-20" /> : <dt className="text-xs text-foreground-muted">{l}</dt>}
              <dd className="mt-1">
                <Sk className="h-3.5 w-32" />
              </dd>
            </div>
          ))}
        </dl>
      </LoadingSection>
      <LoadingSection title="Workloads">
        <FieldsLoading labels={['Namespace', 'Placement', 'Pod size', 'Replicas', 'Compute', 'Image']} wide={['Compute', 'Image']} />
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">Deployments</h3>
          <ListRows widths={['w-40', 'w-32', 'w-36']} />
        </div>
      </LoadingSection>
      <DetailGrid>
        <FieldsSection
          title="Database"
          labels={['Mode', 'Size', 'Backups', 'Endpoint', 'Database', 'Port', 'Auth', 'User', 'Instance id', 'Param group', 'Region']}
          wide={['Endpoint']}
        />
        <FieldsSection title="Storage" labels={['S3 bucket', 'Used', 'Allowance', 'CloudFront', 'Plan', 'Created']} wide={['S3 bucket', 'CloudFront']} />
      </DetailGrid>
      <LoadingSection title="Cost breakdown">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 sm:gap-x-6 text-sm">
          <span className="text-xs text-foreground-muted">Part</span>
          <span className="text-xs text-foreground-muted text-right">AWS /mo</span>
          <span className="text-xs text-foreground-muted text-right">Price /mo</span>
          {['w-32', 'w-24', 'w-28', 'w-20'].map(w => (
            <div key={w} className="contents">
              <div className="border-t border-border-default py-2.5">
                <Sk className={`h-3.5 ${w}`} />
              </div>
              <div className="border-t border-border-default py-2.5">
                <Sk className="ml-auto h-3.5 w-16" />
              </div>
              <div className="border-t border-border-default py-2.5">
                <Sk className="ml-auto h-3.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </LoadingSection>
      <LoadingSection title="DNS">
        <p className="text-xs text-foreground-muted mb-3">Re-sync adds any host the current plan includes (e.g. forms-) and removes hosts it no longer does. Active stores only.</p>
        <div className="space-y-2.5">
          {['w-48', 'w-56', 'w-52'].map(w => (
            <div key={w} className="flex items-center justify-between gap-3">
              <Sk className={`h-3 ${w}`} />
              <Sk className="h-3 w-28" />
            </div>
          ))}
        </div>
      </LoadingSection>
      <FieldsSection title="Schema version" labels={['Store is on', 'Platform is on', 'Last run', 'Result']} />
      <LoadingSection title="Custom domains" lines={2} />
    </div>
  )
}

function Tile({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 sm:p-4 min-w-0">
      <div className="text-[11px] sm:text-xs text-foreground-muted uppercase tracking-wide font-medium truncate">{label}</div>
      <Sk className="mt-1.5 h-5 sm:h-6 w-20" />
    </div>
  )
}

function SettingRowLoading({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 min-w-0">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-foreground-muted font-medium">{title}</p>
        <Sk className="mt-1.5 h-3.5 w-48" />
      </div>
      <Sk className="h-control w-28 rounded-lg" />
    </div>
  )
}

function TableSection({ title, columns, children }: { title: string; columns: string[]; children?: ReactNode }) {
  return (
    <LoadingSection title={title}>
      {children}
      <LoadingTable columns={columns} rows={6} bare />
    </LoadingSection>
  )
}

/** The Billing detail page's body below the header. */
export function BillingDetailLoading() {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        {['Settlement balance', 'GMV', 'Tenant share', 'Your commission', 'Gateway fees', 'COD'].map(l => (
          <Tile key={l} label={l} />
        ))}
      </div>
      <DetailGrid>
        <LoadingSection title="Accounts">
          <div className="divide-y divide-border-default">
            {['Collection account', 'Delivery account', 'Settlements'].map(t => (
              <SettingRowLoading key={t} title={t} />
            ))}
          </div>
        </LoadingSection>
        <LoadingSection title="Subscription">
          <FieldsLoading
            labels={['Plan', 'Status', 'Billing', 'Price / month', 'Plan fee', 'Infra rate', 'Infra this month', 'Payout', 'Razorpay subscription', 'Linked account']}
            wide={['Razorpay subscription', 'Linked account']}
          />
          <p className="mt-3 text-xs text-foreground-muted">Charges collected appear as Subscription charge rows in the settlement ledger below.</p>
        </LoadingSection>
      </DetailGrid>
      <TableSection title="Shipping wallet" columns={['Type', 'Order / AWB', 'Note', 'Amount', 'Date']}>
        <div className="space-y-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            {['Balance', 'Minimum', 'Ships on'].map(l => (
              <Tile key={l} label={l} />
            ))}
          </div>
          <p className="text-xs text-foreground-muted">Prepaid. Shipments on the platform Delhivery account are debited here; so are messaging and AI usage.</p>
        </div>
      </TableSection>
      <TableSection title="Transactions & splits" columns={['Order', 'Gross', 'Tenant share', 'Commission', 'Gateway fee', 'Mode', 'Status', 'Date']} />
      <TableSection title="Settlement ledger" columns={['Entry', 'Note', 'Amount', 'Date']} />
    </>
  )
}
