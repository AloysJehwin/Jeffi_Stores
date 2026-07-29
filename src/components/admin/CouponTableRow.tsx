'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import HoverCard from '@/components/ui/HoverCard'
import DeleteCouponButton from '@/components/admin/DeleteCouponButton'
import { ap } from '@/lib/admin-path'

interface CouponRow {
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

export default function CouponTableRow({ coupon: c, backUrl = '/admin/coupons' }: { coupon: CouponRow; backUrl?: string }) {
  const isExpired = c.valid_until && new Date(c.valid_until) < new Date()
  const router = useRouter()

  return (
    <tr className="hover:bg-surface-secondary/50 transition-colors cursor-pointer" onClick={() => router.push(ap(`/admin/coupons/${c.id}?back=${encodeURIComponent(backUrl)}`))}>
      <td className="px-4 py-3 font-mono font-bold">
        <div className="flex flex-col gap-1">
          <HoverCard
            trigger={
              <Link
                href={ap(`/admin/coupons/${c.id}?back=${encodeURIComponent(backUrl)}`)}
                className="text-accent-500 hover:text-accent-600 hover:underline transition-colors"
                onClick={e => e.stopPropagation()}
              >
                {c.code}
              </Link>
            }
            align="left"
            side="bottom"
            width="270px"
          >
            <div className="p-3 space-y-2">
              <p className="font-mono font-bold text-accent-500 text-sm">{c.code}</p>
              {c.description && (
                <p className="text-xs text-foreground-secondary">{c.description}</p>
              )}
              <div className="text-xs text-foreground-secondary space-y-1">
                <div className="flex justify-between gap-4">
                  <span>Discount</span>
                  <span className="font-semibold text-foreground">
                    {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                  </span>
                </div>
                {c.min_purchase_amount && (
                  <div className="flex justify-between gap-4">
                    <span>Min purchase</span>
                    <span className="text-foreground">₹{c.min_purchase_amount}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Usage</span>
                  <span className="text-foreground">
                    {c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ''} uses
                  </span>
                </div>
                {c.valid_until && (
                  <div className="flex justify-between gap-4">
                    <span>Valid until</span>
                    <span className={isExpired ? 'text-red-500' : 'text-foreground'}>
                      {new Date(c.valid_until).toLocaleDateString('en-IN')}
                      {isExpired && ' (expired)'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span>Status</span>
                  <span className={`font-medium ${c.is_active ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>
          </HoverCard>
          {c.generated_for_campaign && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 w-fit">
              {c.generated_for_campaign}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 capitalize text-foreground-secondary">{c.discount_type}</td>
      <td className="px-4 py-3 font-medium">{c.discount_type === 'percentage' ? `${c.discount_value}%` : `₹${c.discount_value}`}</td>
      <td className="px-4 py-3 text-foreground-secondary">{c.min_purchase_amount ? `₹${c.min_purchase_amount}` : '—'}</td>
      <td className="px-4 py-3 text-foreground-secondary">{c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ''}</td>
      <td className="px-4 py-3 text-foreground-secondary">
        {c.valid_until ? (
          <span className={isExpired ? 'text-red-500' : ''}>{new Date(c.valid_until).toLocaleDateString('en-IN')}</span>
        ) : '—'}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {c.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <Link href={ap(`/admin/coupons/edit/${c.id}?back=${encodeURIComponent(backUrl)}`)} className="text-accent-500 hover:underline text-sm">Edit</Link>
          <DeleteCouponButton id={c.id} code={c.code} />
        </div>
      </td>
    </tr>
  )
}
