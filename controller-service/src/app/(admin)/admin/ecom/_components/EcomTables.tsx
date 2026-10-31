'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DataTable, badgeCls, type DataCol } from '@/components/admin/kit'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import PurgeCustomerButton from '@controller/components/admin/ecom/PurgeCustomerButton'
import type { TenantRow } from '@/lib/tenant-registry/tenants'
import EcomCustomersMobileList from '../customers/_components/EcomCustomersMobileList'
import EcomBillingMobileList from '../billing/_components/EcomBillingMobileList'
import EcomInstancesMobileList from '../instances/_components/EcomInstancesMobileList'

// Client table wrappers for the platform list pages (columns hold functions, so they live here).

const inr = (v: unknown) => (v ? '₹' + Number(v).toLocaleString('en-IN') : '-')
// Same rule as hasService(t, 'store') in lib/tenant-registry (that module is server-only).
const isStore = (t: TenantRow) => (t.service_types ?? ['store']).includes('store')
const nameLink = (href: string, name: string) => (
  <Link href={href} className="font-medium text-foreground hover:text-accent-600" onClick={e => e.stopPropagation()}>
    {name}
  </Link>
)

export function EcomCustomersTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const view = (t: TenantRow) => `/admin/ecom/customers/${t.id}/view?tab=overview`
  const cols: DataCol<TenantRow>[] = [
    { key: 'name', label: 'Customer', sort: t => t.display_name.toLowerCase(), render: t => nameLink(view(t), t.display_name) },
    {
      key: 'subdomain',
      label: 'Subdomain',
      sort: t => (isStore(t) ? t.slug : '~'),
      render: t =>
        isStore(t) ? (
          <span className="text-foreground-secondary">{t.slug}.jeffistores.in</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className={badgeCls('blue')}>API workspace</span>
            <span className="text-xs text-foreground-muted">
              {(t.service_types ?? [])
                .filter(x => x !== 'store')
                .map(x => (x === 'messaging' ? 'Messaging' : 'Documents'))
                .join(' + ')}{' '}
              · pay as you go
            </span>
            {t.store_request && <span className={badgeCls('amber')}>Store upgrade</span>}
          </span>
        ),
    },
    { key: 'plan', label: 'Plan', sort: t => (isStore(t) ? t.plan || '' : ''), render: t => (isStore(t) ? <span className="capitalize text-foreground-secondary">{t.plan || '-'}</span> : null) },
    {
      key: 'price',
      label: 'Price',
      sortType: 'number',
      sort: t => (isStore(t) ? Number(t.monthly_price_inr) || 0 : 0),
      render: t =>
        isStore(t) ? (
          <span className="text-foreground-secondary">
            {inr(t.monthly_price_inr)}
            {t.daily_payout ? ' +daily' : ''}
          </span>
        ) : null,
    },
    { key: 'status', label: 'Status', sort: t => t.status, render: t => <StatusPill status={t.status} /> },
    { key: 'created', label: 'Created', sortParam: 'created_at', sortType: 'date', sort: t => new Date(t.created_at).getTime(), render: t => <span className="text-foreground-muted">{new Date(t.created_at).toLocaleDateString('en-IN')}</span> },
    {
      key: 'actions',
      label: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: t =>
        isStore(t) && ['terminated', 'deprovisioned', 'suspended'].includes(t.status) ? (
          <span className="inline-flex justify-end" onClick={e => e.stopPropagation()}>
            <PurgeCustomerButton tenantId={t.id} slug={t.slug} />
          </span>
        ) : null,
    },
  ]
  return (
    <DataTable
      rows={tenants}
      cols={cols}
      rowKey={t => t.id}
      empty="No tenants match."
      onRowClick={t => router.push(view(t))}
      mobile={rows => <EcomCustomersMobileList tenants={rows} />}
    />
  )
}

export function EcomBillingTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const view = (t: TenantRow) => `/admin/ecom/billing/${t.id}/view`
  const cols: DataCol<TenantRow>[] = [
    { key: 'name', label: 'Store', sort: t => t.display_name.toLowerCase(), render: t => nameLink(view(t), t.display_name) },
    { key: 'plan', label: 'Plan', sort: t => t.plan || '', render: t => <span className="capitalize text-foreground-secondary">{t.plan || '-'}</span> },
    { key: 'monthly', label: 'Monthly', sortType: 'number', sort: t => Number(t.monthly_price_inr) || 0, render: t => <span className="text-foreground-secondary">{inr(t.monthly_price_inr)}</span> },
    { key: 'payout', label: 'Payout', sort: t => (t.daily_payout ? 0 : 1), render: t => <span className="text-foreground-secondary">{t.daily_payout ? 'Daily (+5%)' : 'Weekly'}</span> },
    { key: 'status', label: 'Status', sort: t => t.status, render: t => <StatusPill status={t.status} /> },
  ]
  return (
    <DataTable
      rows={tenants}
      cols={cols}
      rowKey={t => t.id}
      empty="No tenants match."
      onRowClick={t => router.push(view(t))}
      mobile={rows => <EcomBillingMobileList tenants={rows} />}
    />
  )
}

export function EcomInstancesTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const view = (t: TenantRow) => `/admin/ecom/instances/${t.id}/view`
  const cols: DataCol<TenantRow>[] = [
    { key: 'name', label: 'Store', sort: t => t.display_name.toLowerCase(), render: t => nameLink(view(t), t.display_name) },
    {
      key: 'rds',
      label: 'RDS endpoint',
      sort: t => t.rds_endpoint || '',
      render: t => <span className="font-mono text-xs text-foreground-secondary">{t.rds_endpoint || <span className="text-amber-500">not provisioned</span>}</span>,
    },
    { key: 'ec2', label: 'EC2 target', sort: t => t.ec2_target || 'pool', render: t => <span className="text-foreground-secondary">{t.ec2_target || 'pool'}</span> },
    { key: 's3', label: 'S3 bucket', sort: t => t.s3_bucket || '', render: t => <span className="font-mono text-xs text-foreground-secondary">{t.s3_bucket || '-'}</span> },
    { key: 'region', label: 'Region', sort: t => t.region || '', render: t => <span className="text-foreground-secondary">{t.region || '-'}</span> },
  ]
  return (
    <DataTable
      rows={tenants}
      cols={cols}
      rowKey={t => t.id}
      empty="No tenants match."
      onRowClick={t => router.push(view(t))}
      mobile={rows => <EcomInstancesMobileList tenants={rows} />}
    />
  )
}
