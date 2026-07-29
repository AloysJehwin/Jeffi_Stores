import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { queryOne, queryCount } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Coupon {
  id: string
  code: string
  description: string | null
  discount_type: string
  discount_value: number
  min_purchase_amount: number | null
  max_discount_amount: number | null
  usage_limit: number | null
  usage_limit_per_user: number | null
  times_used: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  auto_generated: boolean
  generated_for_campaign: string | null
}

export default async function CouponViewPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ back?: string }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const backUrl = back && back.startsWith('/admin/coupons') ? back : '/admin/coupons'

  const coupon = await queryOne<Coupon>('SELECT * FROM coupons WHERE id = $1', [id])
  if (!coupon) notFound()

  const hasDraft = await queryOne<{ coupon_id: string }>(
    'SELECT coupon_id FROM coupon_drafts WHERE coupon_id = $1', [id]
  )

  const timesUsed = await queryCount('SELECT COUNT(*) FROM coupon_usage WHERE coupon_id = $1', [id])
  const isExpired = coupon.valid_until && new Date(coupon.valid_until) < new Date()

  const row = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between py-3 border-b border-border-default last:border-0">
      <span className="text-sm text-foreground-secondary w-40 flex-shrink-0">{label}</span>
      <span className="text-sm text-foreground font-medium text-right">{value}</span>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={ap(backUrl, host)} className="text-foreground-muted hover:text-foreground transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground font-mono">{coupon.code}</h1>
            <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${coupon.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
              {coupon.is_active ? 'Active' : 'Inactive'}
            </span>
            {isExpired && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                Expired
              </span>
            )}
            {coupon.generated_for_campaign && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                {coupon.generated_for_campaign}
              </span>
            )}
          </div>
          {coupon.description && (
            <p className="text-sm text-foreground-secondary mt-1">{coupon.description}</p>
          )}
        </div>
        <Link
          href={ap(`/admin/coupons/edit/${id}?back=${encodeURIComponent(backUrl)}`, host)}
          className="flex-shrink-0 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors"
        >
          {hasDraft ? 'Edit Draft' : 'Edit'}
        </Link>
      </div>

      {hasDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Unpublished changes exist for this coupon.</p>
          </div>
          <Link
            href={ap(`/admin/coupons/edit/${id}?back=${encodeURIComponent(backUrl)}`, host)}
            className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-medium ml-4 flex-shrink-0"
          >
            Review draft →
          </Link>
        </div>
      )}

      {/* Details card */}
      <div className="bg-surface-elevated rounded-lg border border-border-default p-5">
        {row('Discount Type', <span className="capitalize">{coupon.discount_type}</span>)}
        {row('Discount Value', coupon.discount_type === 'percentage' ? `${coupon.discount_value}% off` : `₹${coupon.discount_value} off`)}
        {row('Min Purchase', coupon.min_purchase_amount ? `₹${coupon.min_purchase_amount}` : '—')}
        {row('Max Discount', coupon.max_discount_amount ? `₹${coupon.max_discount_amount}` : '—')}
        {row('Usage Limit', coupon.usage_limit ? `${timesUsed} / ${coupon.usage_limit} used` : `${timesUsed} used (unlimited)`)}
        {row('Per-User Limit', coupon.usage_limit_per_user ? `${coupon.usage_limit_per_user} per user` : 'Unlimited')}
        {row('Valid From', coupon.valid_from ? new Date(coupon.valid_from).toLocaleString('en-IN') : '—')}
        {row('Valid Until', coupon.valid_until
          ? <span className={isExpired ? 'text-red-500' : ''}>{new Date(coupon.valid_until).toLocaleString('en-IN')}{isExpired ? ' (expired)' : ''}</span>
          : '—'
        )}
        {row('Auto Generated', coupon.auto_generated ? 'Yes' : 'No')}
      </div>
    </div>
  )
}
