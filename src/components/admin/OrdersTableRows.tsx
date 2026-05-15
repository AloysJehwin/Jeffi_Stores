'use client'

import { useState } from 'react'
import Link from 'next/link'
import HoverCard from '@/components/ui/HoverCard'
import OrderDetailModal from '@/components/admin/OrderDetailModal'

function statusBadgeClass(status: string) {
  if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  if (status === 'processing' || status === 'shipped') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
  if (status === 'out_for_delivery') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
  if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
  if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
}

function paymentBadgeClass(status: string) {
  if (status === 'paid') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
  if (status === 'pending') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
  return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
}

function statusLabel(status: string) {
  if (status === 'cancel_requested') return 'Cancel Requested'
  if (status === 'out_for_delivery') return 'Out for Delivery'
  return status.replace(/_/g, ' ')
}

function OrderPopover({ order }: { order: any }) {
  const orderNum = order.order_number || order.id.slice(0, 8)
  const date = new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const amount = Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })

  return (
    <HoverCard
      trigger={
        <span className="cursor-default underline decoration-dotted underline-offset-2 text-foreground font-medium hover:text-accent-500 transition-colors" onClick={e => e.stopPropagation()}>
          #{orderNum}
        </span>
      }
      align="left"
      side="bottom"
      width="380px"
    >
      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-foreground text-sm font-mono break-all">#{orderNum}</p>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            order.source === 'offline'
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
          }`}>
            {order.source === 'offline' ? 'Offline' : 'Online'}
          </span>
        </div>
        <div className="text-xs text-foreground-secondary space-y-1">
          <div className="flex justify-between">
            <span>Date</span>
            <span className="text-foreground">{date}</span>
          </div>
          <div className="flex justify-between">
            <span>Amount</span>
            <span className="font-semibold text-foreground">₹{amount}</span>
          </div>
          <div className="flex justify-between">
            <span>Payment</span>
            <span className={`font-medium ${order.payment_status === 'paid' ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
              {order.payment_status}
            </span>
          </div>
        </div>
        <div className="pt-1 border-t border-border-default flex flex-col gap-1.5">
          <a
            href={`/api/admin/packing-slips/${order.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-accent-500 hover:text-accent-600 font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Packing Slip
          </a>
          <a
            href={`/api/admin/orders/${order.id}/shipping-label?size=4R&inline=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-accent-500 hover:text-accent-600 font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Shipping Label
          </a>
        </div>
      </div>
    </HoverCard>
  )
}

function CustomerPopover({ order }: { order: any }) {
  const name = order.users
    ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest'
    : order.customer_name || 'Guest'
  const email = order.users?.email || order.billing_email
  const phone = order.users?.phone || order.billing_address?.phone

  return (
    <HoverCard
      trigger={
        <span className="cursor-default underline decoration-dotted underline-offset-2 text-foreground hover:text-accent-500 transition-colors" onClick={e => e.stopPropagation()}>
          {name}
        </span>
      }
      align="left"
      side="bottom"
      width="260px"
    >
      <div className="p-3 space-y-2">
        <p className="font-semibold text-foreground text-sm">{name}</p>
        {email && (
          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <a href={`mailto:${email}`} className="hover:text-accent-500 truncate">{email}</a>
          </div>
        )}
        {phone && (
          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <span>{phone}</span>
          </div>
        )}
        {order.users?.id && (
          <div className="pt-1 border-t border-border-default">
            <Link href={`/admin/customers/${order.users.id}`} className="text-xs text-accent-500 hover:text-accent-600 font-medium">
              View customer profile →
            </Link>
          </div>
        )}
      </div>
    </HoverCard>
  )
}

export default function OrdersTableRows({ orders }: { orders: any[] }) {
  const [selected, setSelected] = useState<any>(null)

  if (!orders.length) {
    return (
      <tr>
        <td colSpan={8} className="px-6 py-12 text-center text-foreground-muted">No orders found.</td>
      </tr>
    )
  }

  return (
    <>
      <OrderDetailModal order={selected} onClose={() => setSelected(null)} />
      {orders.map((order: any) => (
        <tr
          key={order.id}
          className="hover:bg-surface-secondary cursor-pointer"
          onClick={() => setSelected(order)}
        >
          <td className="px-6 py-4 whitespace-nowrap">
            <OrderPopover order={order} />
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              order.source === 'offline'
                ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
            }`}>
              {order.source === 'offline' ? 'Offline' : 'Online'}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div>
              <CustomerPopover order={order} />
              <div className="text-xs text-foreground-muted mt-0.5">{order.users?.email || order.billing_email}</div>
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <div>
              <div className="text-sm text-foreground">{new Date(order.created_at).toLocaleDateString('en-IN')}</div>
              <div className="text-xs text-foreground-muted">{new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</div>
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className="text-sm font-medium text-foreground">
              Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${paymentBadgeClass(order.payment_status)}`}>
              {order.payment_status}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusBadgeClass(order.status)}`}>
              {statusLabel(order.status)}
            </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={e => e.stopPropagation()}>
            <Link href={`/admin/orders/${order.id}`} className="text-accent-500 hover:text-accent-600">View Details</Link>
          </td>
        </tr>
      ))}
    </>
  )
}
