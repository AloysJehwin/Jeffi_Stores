'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Tooltip from '@/components/ui/Tooltip'
import HoverCard from '@/components/ui/HoverCard'
import { ap } from '@/lib/shared/admin-path'
import { DataTable, Dialog, Field, Fields, badgeCls, type DataCol } from '@/components/admin/kit'
import CustomersMobileList from './CustomersMobileList'
import { businessLabel, businessTone, customerStatus, fullName, healthTone, inr } from './status-maps'

const joined = (d: string, long = false) =>
  new Date(d).toLocaleDateString('en-IN', long ? { day: '2-digit', month: 'short', year: 'numeric' } : undefined)

function TagChips({ tags, max }: { tags: string[]; max: number }) {
  return (
    <div className="mt-1.5 flex max-w-[220px] flex-wrap gap-1">
      {tags.slice(0, max).map(tag => (
        <span
          key={tag}
          className="whitespace-nowrap rounded bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-500"
        >
          {tag}
        </span>
      ))}
      {tags.length > max && (
        <span className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
          +{tags.length - max}
        </span>
      )}
    </div>
  )
}

function StatusChips({ c, tooltips }: { c: any; tooltips?: boolean }) {
  const s = customerStatus(c)
  const status = <span className={badgeCls(s.tone)}>{s.label}</span>
  const biz =
    c.user_type === 'business' ? (
      <span className={badgeCls(businessTone(c.bp_approval_status))}>{businessLabel(c.bp_approval_status)}</span>
    ) : null
  if (!tooltips)
    return (
      <div className="flex flex-wrap gap-1.5">
        {status}
        {biz}
      </div>
    )
  return (
    <div className="flex flex-col items-start gap-1">
      <Tooltip
        content={
          c.is_flagged
            ? 'Account flagged — potential fraud or policy violation'
            : c.is_active
              ? 'Account in good standing'
              : 'Account deactivated'
        }
      >
        {status}
      </Tooltip>
      {biz && (
        <Tooltip
          content={`Business partner · ${c.bp_approval_status === 'approved' ? 'Approved' : c.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending approval'}${c.bp_company_name ? ` · ${c.bp_company_name}` : ''}`}
        >
          {biz}
        </Tooltip>
      )}
    </div>
  )
}

export default function CustomersTable({
  customers,
  total,
  page,
  pageSize,
  query,
  backUrl,
}: {
  customers: any[]
  total: number
  page: number
  pageSize: number
  /** The list's own params (tab, filters, sort), carried on page links as before. */
  query: Record<string, string | undefined>
  backUrl: string
}) {
  const [open, setOpen] = useState<any>(null)
  // Clone every param so advancing page keeps tab/filters/sort; otherwise the parent Suspense re-keys.
  const sp = useSearchParams()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set('page', String(p))
    else params.delete('page')
    const qs = params.toString()
    return ap(`/admin/customers${qs ? `?${qs}` : ''}`)
  }
  const viewHref = (c: any) => ap(`/admin/customers/${c.id}/view?back=${encodeURIComponent(backUrl)}`)

  const cols: DataCol<any>[] = [
    {
      key: 'name',
      label: 'Name',
      sortParam: 'name',
      render: c => (
        <div className="min-w-0" onClick={e => e.stopPropagation()}>
          <HoverCard
            trigger={
              <Link
                href={viewHref(c)}
                className="whitespace-nowrap font-medium text-foreground hover:text-accent-500 transition-colors"
              >
                {fullName(c, '—')}
              </Link>
            }
            align="left"
            side="bottom"
            width="260px"
          >
            <div className="space-y-2 p-3">
              <p className="text-sm font-semibold text-foreground">{fullName(c, '—')}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {c.email && (
                  <>
                    <span className="text-foreground-muted">Email</span>
                    <span className="truncate text-foreground">{c.email}</span>
                  </>
                )}
                {c.phone && (
                  <>
                    <span className="text-foreground-muted">Phone</span>
                    <span className="text-foreground">{c.phone}</span>
                  </>
                )}
                <span className="text-foreground-muted">Orders</span>
                <span className="font-medium text-foreground">{Number(c.order_count)}</span>
                <span className="text-foreground-muted">Lifetime</span>
                <span className="font-semibold text-foreground">{inr(c.lifetime_value)}</span>
                <span className="text-foreground-muted">Status</span>
                <span>
                  <span className={badgeCls(customerStatus(c).tone)}>{customerStatus(c).label}</span>
                </span>
                {c.user_type === 'business' && (
                  <>
                    <span className="text-foreground-muted">Type</span>
                    <span className="text-foreground">
                      Business{c.bp_company_name ? ` · ${c.bp_company_name}` : ''}
                    </span>
                  </>
                )}
                <span className="text-foreground-muted">Joined</span>
                <span className="text-foreground">{joined(c.created_at, true)}</span>
              </div>
              {c.tags?.length > 0 && (
                <div className="border-t border-border-default pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-foreground-muted">Tags</p>
                  <TagChips tags={c.tags} max={99} />
                </div>
              )}
            </div>
          </HoverCard>
          {c.tags?.length > 0 && <TagChips tags={c.tags} max={3} />}
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      sortParam: 'email',
      render: c => <span className="text-foreground">{c.email}</span>,
    },
    {
      key: 'phone',
      label: 'Phone',
      sortParam: 'phone',
      hideBelow: 'lg',
      render: c => <span className="whitespace-nowrap text-foreground">{c.phone || '—'}</span>,
    },
    {
      key: 'joined',
      label: 'Joined',
      sortParam: 'joined',
      hideBelow: 'lg',
      render: c => (
        <Tooltip
          content={new Date(c.created_at).toLocaleString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        >
          <span className="cursor-default whitespace-nowrap text-foreground">{joined(c.created_at)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'orders',
      label: 'Orders',
      sortParam: 'orders',
      num: true,
      render: c => (
        <Tooltip content={`${Number(c.order_count)} total orders placed`}>
          <span className="cursor-default">{Number(c.order_count)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'health',
      label: 'Health',
      sortParam: 'health',
      render: c =>
        c.health_score == null ? (
          <span className="text-xs text-foreground-muted">—</span>
        ) : (
          <Tooltip
            content={`Churn risk: ${c.churn_risk || 'unknown'}${c.trend_delta_30d ? ` · ${c.trend_delta_30d > 0 ? '+' : ''}${c.trend_delta_30d} (30d)` : ''}`}
          >
            <span className={`${badgeCls(healthTone(c.health_score))} cursor-default font-bold tabular-nums`}>
              {c.health_score}
              {c.trend_delta_30d > 5 && <span className="ml-1 text-green-600">▲</span>}
              {c.trend_delta_30d < -5 && <span className="ml-1 text-red-500">▼</span>}
            </span>
          </Tooltip>
        ),
    },
    { key: 'status', label: 'Status', sortParam: 'status', render: c => <StatusChips c={c} tooltips /> },
  ]

  return (
    <>
      <DataTable<any>
        mode="server"
        rows={customers}
        cols={cols}
        rowKey={c => c.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHref}
        onRowClick={setOpen}
        mobile={rows => <CustomersMobileList customers={rows} backUrl={backUrl} />}
        empty={{ title: 'No customers found.', body: 'Try a different search or clear the filters.' }}
        rowActions={c => [{ key: 'view', kind: 'view', label: 'View Customer', href: viewHref(c) }]}
      />

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? fullName(open) : ''}
        description={open?.email}
        zIndex="z-[300]"
        footer={
          open && (
            <Link
              href={viewHref(open)}
              onClick={() => setOpen(null)}
              className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600"
            >
              Full Profile
            </Link>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <StatusChips c={open} />
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-secondary p-3">
              <div>
                <p className="text-xs text-foreground-muted">Total Orders</p>
                <p className="text-sm font-bold text-foreground">{Number(open.order_count)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-muted">Lifetime Spend</p>
                <p className="text-sm font-bold text-foreground">{inr(open.lifetime_value)}</p>
              </div>
            </div>
            <Fields>
              <Field label="Phone" value={open.phone} />
              <Field label="Joined" value={joined(open.created_at, true)} />
              <Field label="Health" value={open.health_score == null ? null : open.health_score} />
              {open.bp_company_name && <Field label="Company" value={open.bp_company_name} />}
            </Fields>
          </div>
        )}
      </Dialog>
    </>
  )
}
