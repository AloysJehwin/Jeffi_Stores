'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-surface-elevated rounded-xl shadow-2xl border border-border-default w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-border-default">
              <div>
                <h2 className="text-lg font-bold text-foreground font-mono">{c.code}</h2>
                {c.description && <p className="text-xs text-foreground-muted mt-0.5">{c.description}</p>}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${c.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </span>
                {isExpired && (
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                    Expired
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-secondary">
                <div>
                  <p className="text-xs text-foreground-muted">Discount</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">
                    {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Type</p>
                  <p className="text-sm font-semibold text-foreground capitalize mt-0.5">{c.discount_type}</p>
                </div>
                {c.min_purchase_amount && (
                  <div>
                    <p className="text-xs text-foreground-muted">Min Purchase</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">₹{c.min_purchase_amount}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-foreground-muted">Usage</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">
                    {c.times_used}{c.usage_limit ? `/${c.usage_limit}` : ''} uses
                  </p>
                </div>
                {c.valid_until && (
                  <div>
                    <p className="text-xs text-foreground-muted">Valid Until</p>
                    <p className={`text-sm font-semibold mt-0.5 ${isExpired ? 'text-red-500' : 'text-foreground'}`}>
                      {new Date(c.valid_until).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-1 border-t border-border-default">
                <Link
                  href={`/admin/coupons/edit/${c.id}`}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-500 hover:bg-accent-600 text-white transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Edit Coupon
                </Link>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      <tr className="hover:bg-surface-secondary/50 transition-colors cursor-pointer" onClick={() => setOpen(true)}>
        <td className="px-4 py-3 font-mono font-bold" onClick={e => e.stopPropagation()}>
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
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <Link href={`/admin/coupons/edit/${c.id}`} className="text-accent-500 hover:underline text-sm">Edit</Link>
            <DeleteCouponButton id={c.id} code={c.code} />
          </div>
        </td>
      </tr>
    </>
  )
}
