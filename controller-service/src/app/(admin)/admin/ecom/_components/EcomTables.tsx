'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DataTable, badgeCls, type DataCol } from '@/components/admin/kit'
import { StatusPill } from '@/components/admin/ecom/EcomUI'
import PurgeCustomerButton from '@/components/admin/ecom/PurgeCustomerButton'
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
    { key: 'name', label: 'Customer', render: t => nameLink(view(t), t.display_name) },
    {
      key: 'subdomain',
      label: 'Subdomain',
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
    { key: 'plan', label: 'Plan', render: t => (isStore(t) ? <span className="capitalize text-foreground-secondary">{t.plan || '-'}</span> : null) },
    {
      key: 'price',
      label: 'Price',
      render: t =>
        isStore(t) ? (
          <span className="text-foreground-secondary">
            {inr(t.monthly_price_inr)}
            {t.daily_payout ? ' +daily' : ''}
          </span>
        ) : null,
    },
    { key: 'status', label: 'Status', render: t => <StatusPill status={t.status} /> },
    { key: 'created', label: 'Created', render: t => <span className="text-foreground-muted">{new Date(t.created_at).toLocaleDateString('en-IN')}</span> },
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
      mobile={<EcomCustomersMobileList tenants={tenants} />}
    />
  )
}

export function EcomBillingTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const view = (t: TenantRow) => `/admin/ecom/billing/${t.id}/view`
  const cols: DataCol<TenantRow>[] = [
    { key: 'name', label: 'Store', render: t => nameLink(view(t), t.display_name) },
    { key: 'plan', label: 'Plan', render: t => <span className="capitalize text-foreground-secondary">{t.plan || '-'}</span> },
    { key: 'monthly', label: 'Monthly', render: t => <span className="text-foreground-secondary">{inr(t.monthly_price_inr)}</span> },
    { key: 'payout', label: 'Payout', render: t => <span className="text-foreground-secondary">{t.daily_payout ? 'Daily (+5%)' : 'Weekly'}</span> },
    { key: 'status', label: 'Status', render: t => <StatusPill status={t.status} /> },
  ]
  return (
    <DataTable
      rows={tenants}
      cols={cols}
      rowKey={t => t.id}
      empty="No tenants match."
      onRowClick={t => router.push(view(t))}
      mobile={<EcomBillingMobileList tenants={tenants} />}
    />
  )
}

export function EcomInstancesTable({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const view = (t: TenantRow) => `/admin/ecom/instances/${t.id}/view`
  const cols: DataCol<TenantRow>[] = [
    { key: 'name', label: 'Store', render: t => nameLink(view(t), t.display_name) },
    {
      key: 'rds',
      label: 'RDS endpoint',
      render: t => <span className="font-mono text-xs text-foreground-secondary">{t.rds_endpoint || <span className="text-amber-500">not provisioned</span>}</span>,
    },
    { key: 'ec2', label: 'EC2 target', render: t => <span className="text-foreground-secondary">{t.ec2_target || 'pool'}</span> },
    { key: 's3', label: 'S3 bucket', render: t => <span className="font-mono text-xs text-foreground-secondary">{t.s3_bucket || '-'}</span> },
    { key: 'region', label: 'Region', render: t => <span className="text-foreground-secondary">{t.region || '-'}</span> },
  ]
  return (
    <DataTable
      rows={tenants}
      cols={cols}
      rowKey={t => t.id}
      empty="No tenants match."
      onRowClick={t => router.push(view(t))}
      mobile={<EcomInstancesMobileList tenants={tenants} />}
    />
  )
}
