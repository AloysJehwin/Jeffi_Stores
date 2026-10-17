'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import HoverCard from '@/components/ui/HoverCard'
import { useToast } from '@/contexts/ToastContext'
import { ap } from '@/lib/shared/admin-path'
import {
  DataTable,
  Dialog,
  Field,
  Fields,
  StatusBadge,
  ACTIVE_STATUS,
  badgeCls,
  type DataCol,
} from '@/components/admin/kit'
import CouponsMobileList from './CouponsMobileList'

export interface CouponRow {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  usage_limit: number | null
  times_used: number
  valid_until: string | null
  is_active: boolean
  auto_generated: boolean
  generated_for_campaign: string | null
}

const expired = (c: CouponRow) => !!c.valid_until && new Date(c.valid_until) < new Date()
const off = (c: CouponRow) =>
  c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`
const uses = (c: CouponRow) => `${c.times_used}${c.usage_limit ? `/${c.usage_limit}` : ''}`

export default function CouponsTable({
  coupons,
  total,
  page,
  pageSize,
  query,
  backUrl,
}: {
  coupons: CouponRow[]
  total: number
  page: number
  pageSize: number
  /** The list's own params, carried on page links as before. */
  query: Record<string, string | undefined>
  backUrl: string
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState<CouponRow | null>(null)
  const viewHref = (c: CouponRow) => ap(`/admin/coupons/${c.id}?back=${encodeURIComponent(backUrl)}`)

  // Clone every param so advancing page keeps tab/filters/sort; otherwise the parent Suspense re-keys.
  const sp = useSearchParams()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set('page', String(p))
    else params.delete('page')
    const qs = params.toString()
    return ap(`/admin/coupons${qs ? `?${qs}` : ''}`)
  }

  const [gone, setGone] = useState<Set<string>>(new Set())

  async function deleteCoupon(c: CouponRow) {
    const res = await fetch(`/api/admin/coupons/${c.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast((await res.json().catch(() => ({})))?.error || 'Failed to delete coupon', 'error')
      return
    }
    setGone(g => new Set(g).add(String(c.id)))
    router.refresh()
  }

  const cols: DataCol<CouponRow>[] = [
    {
      key: 'code',
      label: 'Code',
      sortParam: 'code',
      render: c => (
        <div className="flex flex-col gap-1">
          <HoverCard
            trigger={
              <Link
                href={viewHref(c)}
                className="font-mono font-bold text-accent-500 hover:text-accent-600 hover:underline"
                onClick={e => e.stopPropagation()}
              >
                {c.code}
              </Link>
            }
            align="left"
            side="bottom"
            width="270px"
          >
            <div className="space-y-2 p-3">
              <p className="font-mono text-sm font-bold text-accent-500">{c.code}</p>
              {c.description && <p className="text-xs text-foreground-secondary">{c.description}</p>}
              <div className="space-y-1 text-xs text-foreground-secondary">
                <div className="flex justify-between gap-4">
                  <span>Discount</span>
                  <span className="font-semibold text-foreground">{off(c)}</span>
                </div>
                {c.min_purchase_amount && (
                  <div className="flex justify-between gap-4">
                    <span>Min purchase</span>
                    <span className="text-foreground">₹{c.min_purchase_amount}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Usage</span>
                  <span className="text-foreground">{uses(c)} uses</span>
                </div>
                {c.valid_until && (
                  <div className="flex justify-between gap-4">
                    <span>Valid until</span>
                    <span className={expired(c) ? 'text-red-500' : 'text-foreground'}>
                      {new Date(c.valid_until).toLocaleDateString('en-IN')}
                      {expired(c) && ' (expired)'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Status</span>
                  <StatusBadge status={String(c.is_active)} map={ACTIVE_STATUS} />
                </div>
              </div>
            </div>
          </HoverCard>
          {c.generated_for_campaign && <span className={`${badgeCls('blue')} w-fit`}>{c.generated_for_campaign}</span>}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortParam: 'type',
      render: c => <span className="capitalize text-foreground-secondary">{c.discount_type}</span>,
    },
    {
      key: 'value',
      label: 'Value',
      sortParam: 'value',
      num: true,
      render: c => (
        <span className="font-medium">
          {c.discount_type === 'percentage' ? `${c.discount_value}%` : `₹${c.discount_value}`}
        </span>
      ),
    },
    {
      key: 'min',
      label: 'Min Purchase',
      sortParam: 'min_purchase',
      num: true,
      hideBelow: 'lg',
      render: c => (
        <span className="text-foreground-secondary">{c.min_purchase_amount ? `₹${c.min_purchase_amount}` : '—'}</span>
      ),
    },
    {
      key: 'usage',
      label: 'Usage',
      sortParam: 'usage',
      num: true,
      render: c => <span className="text-foreground-secondary">{uses(c)}</span>,
    },
    {
      key: 'valid',
      label: 'Valid Until',
      sortParam: 'valid_until',
      hideBelow: 'lg',
      render: c =>
        c.valid_until ? (
          <span className={expired(c) ? 'text-red-500' : 'text-foreground-secondary'}>
            {new Date(c.valid_until).toLocaleDateString('en-IN')}
          </span>
        ) : (
          <span className="text-foreground-muted">—</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      sortParam: 'status',
      render: c => <StatusBadge status={String(c.is_active)} map={ACTIVE_STATUS} />,
    },
  ]

  return (
    <>
      <DataTable<CouponRow>
        mode="server"
        hide={r => gone.has(String(r.id))}
        rows={coupons}
        cols={cols}
        rowKey={c => c.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHref}
        onRowClick={setOpen}
        mobile={rows => <CouponsMobileList coupons={rows} backUrl={backUrl} />}
        empty={{ title: 'No coupons found', body: 'Try a different search or clear the filters.' }}
        rowActions={c => [
          {
            key: 'edit',
            kind: 'edit',
            label: 'Edit Coupon',
            href: ap(`/admin/coupons/${c.id}/edit?back=${encodeURIComponent(backUrl)}`),
            scope: 'coupons:write',
          },
          {
            key: 'delete',
            kind: 'delete',
            label: 'Delete Coupon',
            scope: 'coupons:write',
            onSelect: () => deleteCoupon(c),
            confirm: {
              title: 'Delete Coupon',
              message: `Delete coupon "${c.code}"? This action cannot be undone.`,
              confirmLabel: 'Delete',
              variant: 'danger',
            },
          },
        ]}
      />

      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title={open && <span className="font-mono">{open.code}</span>}
        description={open?.description}
        zIndex="z-[300]"
        footer={
          open && (
            <Link
              href={viewHref(open)}
              onClick={() => setOpen(null)}
              className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600"
            >
              View Coupon
            </Link>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={String(open.is_active)} map={ACTIVE_STATUS} />
              {expired(open) && <span className={badgeCls('amber')}>Expired</span>}
              {open.generated_for_campaign && (
                <span className={badgeCls('blue')}>Campaign: {open.generated_for_campaign}</span>
              )}
            </div>
            <Fields>
              <Field label="Discount" value={off(open)} />
              <Field label="Type" value={<span className="capitalize">{open.discount_type}</span>} />
              {open.min_purchase_amount && <Field label="Min Purchase" value={`₹${open.min_purchase_amount}`} />}
              <Field label="Usage" value={`${uses(open)} uses`} />
              {open.valid_until && (
                <Field
                  label="Valid Until"
                  value={
                    <span className={expired(open) ? 'text-red-500' : ''}>
                      {new Date(open.valid_until).toLocaleDateString('en-IN')}
                    </span>
                  }
                />
              )}
            </Fields>
          </div>
        )}
      </Dialog>
    </>
  )
}
