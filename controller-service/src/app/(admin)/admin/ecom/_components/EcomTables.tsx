'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Receipt, Server, Trash2 } from 'lucide-react'
import { DataTable, badgeCls, StatusBadge, useActionToast, type DataCol } from '@/components/admin/kit'
import { usePrompt } from '@/contexts/ConfirmContext'
import {
  CostCell,
  JOB_STATUS,
  PlacementCell,
  RunningCell,
  ServersCell,
  SpendCell,
  StoreCell,
  TenantStatus,
  bytes,
  dateIN,
  dateTimeIN,
  inr,
  inrHr,
  storeHost,
} from '@controller/components/admin/ecom/cells'
import { PURGE_WARNING, purgeCustomers, usePurgeCustomer } from '@controller/components/admin/ecom/PurgeCustomerButton'
import type { EcomRow } from '@controller/lib/ecom/rows'

// Client tables for the Ecom Store list pages (columns hold functions, so they live here).
// `fleetKnown` is false outside the cluster: fleet columns then show "—".

type Props = { rows: EcomRow[]; fleetKnown: boolean }

const num = (v: number | null | undefined) => (v == null ? -Infinity : Number(v))
const priceMonth = (t: EcomRow) => t.price_inr_month ?? t.cost.priceMonth
const muted = (s: ReactNode = '—') => <span className="text-foreground-muted">{s}</span>
const store = (t: EcomRow) => (
  <div className="max-w-[14rem] xl:max-w-[18rem]">
    <StoreCell t={t} />
  </div>
)

/** Rupees, red with a leading minus when negative. */
function Money({ v, signed }: { v: number | null | undefined; signed?: boolean }) {
  if (v == null) return muted()
  const neg = signed && v < 0
  return <span className={`tabular-nums ${neg ? 'text-red-600 dark:text-red-400' : 'text-foreground-secondary'}`}>{neg ? `−${inr(-v)}` : inr(v)}</span>
}

const reviewChip = <span className={badgeCls('amber')}>Needs review</span>

/** Mobile card: the body links to the detail page; an optional action sits under it. */
function Card({ href, title, sub, badges, left, right, action }: { href: string; title: string; sub: string; badges: ReactNode; left?: ReactNode; right?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated">
      <Link href={href} className="block p-3 space-y-2 rounded-xl active:bg-surface-secondary/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{title}</p>
            <p className="text-xs text-foreground-muted truncate">{sub}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">{badges}</div>
        </div>
        {(left || right) && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-foreground-muted">{left}</span>
            <span className="shrink-0 font-semibold text-foreground tabular-nums">{right}</span>
          </div>
        )}
      </Link>
      {action && <div className="flex justify-end border-t border-border-default/60 px-3 py-2">{action}</div>}
    </div>
  )
}

const sub = (t: EcomRow) => (t.isStore ? storeHost(t) : 'API workspace')

// ── Customers ────────────────────────────────────────────────────────────────

export function EcomCustomersTable({ rows, fleetKnown }: Props) {
  const router = useRouter()
  const toast = useActionToast()
  const prompt = usePrompt()
  const purge = usePurgeCustomer()
  const [busy, setBusy] = useState<string | null>(null)
  const view = (t: EcomRow) => `/admin/ecom/customers/${t.id}/view?tab=overview`
  const deletable = (t: EcomRow) => t.isStore && t.purgeable

  const del = async (t: EcomRow) => {
    setBusy(t.id)
    try {
      await purge(t)
    } finally {
      setBusy(null)
    }
  }

  const bulkDelete = async (sel: EcomRow[]) => {
    const go = sel.filter(deletable)
    const skipped = sel.length - go.length
    if (!go.length) {
      toast.warning('None of the selected can be deleted. Only terminated, rejected, or suspended stores with nothing running can.')
      return
    }
    const names = go.map(t => t.slug)
    const list = names.length > 12 ? `${names.slice(0, 12).join(', ')} and ${names.length - 12} more` : names.join(', ')
    const skip = skipped ? `\n\n${skipped} selected ${skipped === 1 ? 'row is' : 'rows are'} skipped: still live, or an API workspace.` : ''
    const typed = await prompt({
      title: `Delete ${go.length} store${go.length === 1 ? '' : 's'} permanently?`,
      message: `${list}\n\n${PURGE_WARNING}${skip}\n\nType DELETE to confirm.`,
      placeholder: 'DELETE',
      confirmLabel: `Delete ${go.length}`,
    })
    if (typed == null) return
    if (typed !== 'DELETE') {
      toast.error('Type DELETE to confirm; nothing was deleted.')
      return
    }
    const results = await purgeCustomers(go)
    const ok = results.filter(r => r.ok)
    const failed = results.filter(r => !r.ok)
    if (ok.length) toast.success(`Deleted ${ok.length}: ${ok.map(r => r.slug).join(', ')}${skipped ? ` (${skipped} skipped)` : ''}`)
    if (failed.length) toast.error(`Not deleted: ${failed.map(r => `${r.slug} (${r.error})`).join('; ')}`)
    if (ok.length) router.refresh()
  }

  const cols: DataCol<EcomRow>[] = [
    { key: 'name', label: 'Customer', sort: t => t.display_name.toLowerCase(), render: store },
    {
      key: 'plan',
      label: 'Plan',
      hideBelow: 'lg',
      sort: t => (t.isStore ? t.plan || '' : '~'),
      render: t => (t.isStore ? <span className="capitalize text-foreground-secondary">{t.plan || '—'}</span> : <span className={badgeCls('blue')}>Pay as you go</span>),
    },
    {
      key: 'running',
      label: 'Running',
      hideBelow: 'lg',
      sortType: 'number',
      sort: t => (t.isStore ? num(t.serversRunning) * 1000 + (t.fleet?.pods.ready ?? 0) : -Infinity),
      render: t => (t.isStore ? <RunningCell fleet={t.fleet} known={fleetKnown} servers={t.serversRunning} /> : muted()),
    },
    {
      key: 'price',
      label: 'Price/mo',
      num: true,
      sort: t => (t.isStore ? num(priceMonth(t)) : -Infinity),
      render: t => (t.isStore ? <CostCell price={priceMonth(t)} aws={t.cost.awsMonth} /> : muted()),
    },
    {
      key: 'spend',
      label: 'Spend MTD',
      num: true,
      hideBelow: 'xl',
      sort: t => num(t.cost.mtdEstimate),
      render: t => (t.isStore ? <SpendCell mtd={t.cost.mtdEstimate} /> : muted()),
    },
    {
      key: 'status',
      label: 'Status',
      sort: t => (t.needs_review ? ' ' : '') + t.status,
      render: t => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <TenantStatus status={t.status} />
          {t.needs_review && reviewChip}
          {t.store_request && <span className={badgeCls('amber')}>Store upgrade</span>}
        </span>
      ),
    },
    { key: 'created', label: 'Created', hideBelow: 'xl', sortParam: 'created_at', sortType: 'date', sort: t => new Date(t.created_at).getTime(), render: t => muted(dateIN(t.created_at)) },
  ]

  return (
    <DataTable
      rows={rows}
      cols={cols}
      rowKey={t => t.id}
      noun="customers"
      empty="No customers match."
      onRowClick={t => router.push(view(t))}
      selectable
      bulkActions={[{ key: 'delete', label: 'Delete', icon: <Trash2 className="w-4 h-4" />, danger: true, onRun: bulkDelete }]}
      rowActions={t => [
        { key: 'view', kind: 'view', href: view(t) },
        { key: 'instance', label: 'Instance', icon: Server, href: `/admin/ecom/instances/${t.id}/view`, hidden: !t.isStore },
        { key: 'billing', label: 'Billing', icon: Receipt, href: `/admin/ecom/billing/${t.id}/view`, hidden: !t.isStore },
        // Not `danger`: that would add a second confirm before the type-the-slug prompt.
        { key: 'delete', label: 'Delete', icon: Trash2, variant: 'danger', hidden: !deletable(t), busy: busy === t.id, onSelect: () => del(t) },
      ]}
      mobileCard={t => (
        <Card
          href={view(t)}
          title={t.display_name}
          sub={sub(t)}
          badges={
            <>
              <TenantStatus status={t.status} />
              {t.needs_review && reviewChip}
            </>
          }
          left={t.isStore ? <span className="capitalize">{t.plan || 'No plan'}</span> : 'Messaging / Documents · pay as you go'}
          right={t.isStore ? (priceMonth(t) == null ? '—' : `${inr(priceMonth(t))}/mo`) : null}
          action={
            deletable(t) ? (
              <button type="button" disabled={busy === t.id} onClick={() => del(t)} className="control-sm border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />
                {busy === t.id ? 'Deleting…' : 'Delete'}
              </button>
            ) : null
          }
        />
      )}
    />
  )
}

// ── Instances ────────────────────────────────────────────────────────────────

function PodsCell({ t, known }: { t: EcomRow; known: boolean }) {
  if (!known) return muted()
  const p = t.fleet?.pods
  if (!p?.total) return muted('None')
  return <span className={`tabular-nums ${p.ready === p.total ? 'text-foreground-secondary' : 'text-amber-600 dark:text-amber-400'}`}>{p.ready}/{p.total}</span>
}

/** On-server Postgres, or the RDS instance (first label of the endpoint) the store's database lives on. */
function DbCell({ t }: { t: EcomRow }) {
  const db = t.applied?.db
  const pg = t.fleet?.postgresReady
  if (db?.mode === 'node' || pg != null)
    return (
      <span className="text-foreground-secondary">
        On-server Postgres{pg === false && <span className="text-amber-600 dark:text-amber-400"> · not ready</span>}
      </span>
    )
  if (!t.rds_endpoint) return muted()
  const kind = db?.mode === 'shared' ? 'Shared RDS' : db?.class || 'RDS'
  return (
    <div className="max-w-[12rem]">
      <p className="text-foreground-secondary">{kind}</p>
      <p className="font-mono text-xs text-foreground-muted truncate">{t.rds_endpoint.split('.')[0]}</p>
    </div>
  )
}

const dbSort = (t: EcomRow) => (t.applied?.db?.mode === 'node' || t.fleet?.postgresReady != null ? 'a' : t.rds_endpoint ? `b${t.rds_endpoint}` : 'z')

export function EcomInstancesTable({ rows, fleetKnown }: Props) {
  const router = useRouter()
  const view = (t: EcomRow) => `/admin/ecom/instances/${t.id}/view`
  const cols: DataCol<EcomRow>[] = [
    { key: 'name', label: 'Store', sort: t => t.display_name.toLowerCase(), render: store },
    { key: 'placement', label: 'Placement', hideBelow: 'lg', sort: t => t.fleet?.placement || '~', render: t => <PlacementCell fleet={t.fleet} known={fleetKnown} /> },
    { key: 'servers', label: 'Servers', sortType: 'number', sort: t => num(t.serversRunning), render: t => <ServersCell fleet={t.fleet} known={fleetKnown} /> },
    { key: 'pods', label: 'Pods ready', sortType: 'number', sort: t => (t.fleet ? t.fleet.pods.ready - t.fleet.pods.total : -Infinity), render: t => <PodsCell t={t} known={fleetKnown} /> },
    { key: 'db', label: 'Database', hideBelow: 'lg', sort: dbSort, render: t => <DbCell t={t} /> },
    { key: 'storage', label: 'Storage', num: true, hideBelow: 'xl', sort: t => num(t.s3_usage_bytes), render: t => <span className="text-foreground-secondary">{bytes(t.s3_usage_bytes)}</span> },
    { key: 'aws', label: 'AWS/mo', num: true, sort: t => num(t.cost.awsMonth), render: t => <Money v={t.cost.awsMonth} /> },
    {
      key: 'rate',
      label: 'Price/h',
      num: true,
      hideBelow: 'lg',
      sort: t => num(t.rate_inr_hour ?? t.cost.priceHour),
      render: t => <span className="text-foreground-secondary">{inrHr(t.rate_inr_hour ?? t.cost.priceHour)}</span>,
    },
  ]
  return (
    <DataTable
      rows={rows}
      cols={cols}
      rowKey={t => t.id}
      noun="stores"
      empty="No stores match."
      onRowClick={t => router.push(view(t))}
      mobileCard={t => (
        <Card
          href={view(t)}
          title={t.display_name}
          sub={sub(t)}
          badges={<TenantStatus status={t.status} />}
          left={<RunningCell fleet={t.fleet} known={fleetKnown} servers={t.serversRunning} />}
          right={t.cost.awsMonth == null ? null : `AWS ${inr(t.cost.awsMonth)}/mo`}
        />
      )}
    />
  )
}

// ── Billing ──────────────────────────────────────────────────────────────────

export function EcomBillingTable({ rows }: { rows: EcomRow[] }) {
  const router = useRouter()
  const view = (t: EcomRow) => `/admin/ecom/billing/${t.id}/view`
  const cols: DataCol<EcomRow>[] = [
    { key: 'name', label: 'Store', sort: t => t.display_name.toLowerCase(), render: store },
    { key: 'plan', label: 'Plan', hideBelow: 'lg', sort: t => t.plan || '', render: t => <span className="capitalize text-foreground-secondary">{t.plan || '—'}</span> },
    { key: 'price', label: 'Price/mo', num: true, sort: t => num(priceMonth(t)), render: t => <Money v={priceMonth(t)} /> },
    { key: 'aws', label: 'AWS/mo', num: true, hideBelow: 'lg', sort: t => num(t.cost.awsMonth), render: t => <Money v={t.cost.awsMonth} /> },
    { key: 'margin', label: 'Margin/mo', num: true, sort: t => num(t.cost.marginMonth), render: t => <Money v={t.cost.marginMonth} signed /> },
    { key: 'mtd', label: 'Spend MTD', num: true, hideBelow: 'xl', sort: t => num(t.cost.mtdEstimate), render: t => <SpendCell mtd={t.cost.mtdEstimate} /> },
    { key: 'gmv', label: 'GMV 30d', num: true, hideBelow: 'xl', sort: t => t.gmv_30d, render: t => <Money v={t.gmv_30d} /> },
    { key: 'commission', label: 'Commission 30d', num: true, hideBelow: 'lg', sort: t => t.commission_30d, render: t => <Money v={t.commission_30d} /> },
    { key: 'wallet', label: 'Wallet', num: true, hideBelow: 'lg', sort: t => num(t.wallet_balance), render: t => <Money v={t.wallet_balance} signed /> },
    { key: 'payout', label: 'Payout', hideBelow: 'xl', sort: t => (t.daily_payout ? 0 : 1), render: t => <span className="text-foreground-secondary">{t.daily_payout ? 'Daily +5%' : 'Weekly'}</span> },
  ]
  return (
    <DataTable
      rows={rows}
      cols={cols}
      rowKey={t => t.id}
      noun="stores"
      empty="No stores match."
      onRowClick={t => router.push(view(t))}
      mobileCard={t => (
        <Card
          href={view(t)}
          title={t.display_name}
          sub={sub(t)}
          badges={<TenantStatus status={t.status} />}
          left={
            <>
              Margin <Money v={t.cost.marginMonth} signed />
            </>
          }
          right={priceMonth(t) == null ? '—' : `${inr(priceMonth(t))}/mo`}
        />
      )}
    />
  )
}

// ── Store status ─────────────────────────────────────────────────────────────

function JobCell({ t }: { t: EcomRow }) {
  if (!t.job_status) return muted()
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge status={t.job_status} map={JOB_STATUS} title={t.job_status === 'failed' ? t.job_error : null} />
      {t.job_step && t.job_status !== 'done' && <span className="max-w-[10rem] truncate text-xs text-foreground-muted">{t.job_step}</span>}
    </span>
  )
}

const domains = (t: EcomRow) => {
  const all = t.custom_domain?.split(', ').filter(Boolean) ?? []
  return all.length ? `${all[0]}${all.length > 1 ? ` +${all.length - 1}` : ''}` : null
}

export function EcomStoreStatusTable({ rows, fleetKnown }: Props) {
  const router = useRouter()
  const view = (t: EcomRow) => `/admin/ecom/store-status/${t.id}/view`
  const cols: DataCol<EcomRow>[] = [
    { key: 'name', label: 'Store', sort: t => t.display_name.toLowerCase(), render: store },
    { key: 'status', label: 'Status', sort: t => t.status, render: t => <TenantStatus status={t.status} /> },
    {
      key: 'serving',
      label: 'Serving',
      sortType: 'number',
      sort: t => (t.fleet?.pods.total ? t.fleet.pods.ready / t.fleet.pods.total : -1),
      render: t => <RunningCell fleet={t.fleet} known={fleetKnown} servers={t.serversRunning} />,
    },
    { key: 'job', label: 'Provisioning', sort: t => t.job_status || '~', render: t => <JobCell t={t} /> },
    { key: 'kyc', label: 'KYC', hideBelow: 'lg', sort: t => (t.needs_review ? 0 : 1), render: t => (t.needs_review ? reviewChip : muted()) },
    { key: 'domain', label: 'Domain', hideBelow: 'xl', sort: t => domains(t) || '~', render: t => <span className="text-foreground-secondary">{domains(t) ?? '—'}</span> },
    {
      key: 'updated',
      label: 'Updated',
      hideBelow: 'lg',
      sortType: 'date',
      sort: t => (t.job_updated_at ? new Date(t.job_updated_at).getTime() : 0),
      render: t => muted(dateTimeIN(t.job_updated_at)),
    },
  ]
  return (
    <DataTable
      rows={rows}
      cols={cols}
      rowKey={t => t.id}
      noun="stores"
      empty="No stores match."
      onRowClick={t => router.push(view(t))}
      mobileCard={t => (
        <Card
          href={view(t)}
          title={t.display_name}
          sub={sub(t)}
          badges={
            <>
              <TenantStatus status={t.status} />
              {t.job_status && t.job_status !== 'done' && <StatusBadge status={t.job_status} map={JOB_STATUS} />}
            </>
          }
          left={<RunningCell fleet={t.fleet} known={fleetKnown} servers={t.serversRunning} />}
          right={t.needs_review ? <span className="text-amber-600 dark:text-amber-400">Needs review</span> : null}
        />
      )}
    />
  )
}
