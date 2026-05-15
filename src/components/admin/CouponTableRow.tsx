'use client'

import Link from 'next/link'
import HoverCard from '@/components/ui/HoverCard'
import DeleteCouponButton from '@/components/admin/DeleteCouponButton'

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
}

export default function CouponTableRow({ coupon: c }: { coupon: CouponRow }) {
  const isExpired = c.valid_until && new Date(c.valid_until) < new Date()

  return (
    <tr className="hover:bg-surface-secondary/50 transition-colors">
      <td className="px-4 py-3 font-mono font-bold">
        <HoverCard
          trigger={
            <span className="text-accent-500 cursor-default underline decoration-dotted underline-offset-2 hover:text-accent-600 transition-colors">
              {c.code}
            </span>
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
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/admin/coupons/edit/${c.id}`} className="text-accent-500 hover:underline text-sm">Edit</Link>
          <DeleteCouponButton id={c.id} code={c.code} />
        </div>
      </td>
    </tr>
  )
}
