'use client'

import { pageHrefFrom, type PageUrls } from '@/lib/admin/page-urls'
import { useState } from 'react'
import Link from 'next/link'
import { Mail, Phone } from 'lucide-react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import HoverCard from '@/components/ui/HoverCard'
import SubscriptionOrderBadge from '@/components/admin/SubscriptionOrderBadge'
import { ap } from '@/lib/shared/admin-path'
import { Badge, DataTable, StatusBadge, type DataCol } from '@/components/admin/kit'
import OrderDetailModal from './OrderDetailModal'
import OrdersMobileList from './OrdersMobileList'
import { ORDER_STATUS_FULL, PAYMENT_STATUS_FULL, inr, sourceLabel, sourceTone } from './status-maps'

const customerName = (o: any) =>
  o.users ? `${o.users.first_name || ''} ${o.users.last_name || ''}`.trim() || o.customer_name || 'Guest' : o.customer_name || 'Guest'

function CustomerPopover({ order }: { order: any }) {
  const name = customerName(order)
  const email = order.users?.email || order.billing_email
  const phone = order.users?.phone || order.billing_address?.phone
  return (
    <HoverCard
      trigger={
        <span className="cursor-default text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-accent-500" onClick={e => e.stopPropagation()}>
          {name}
        </span>
      }
      align="left"
      side="bottom"
      width="260px"
    >
      <div className="space-y-2 p-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        {email && (
          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <a href={`mailto:${email}`} className="truncate hover:text-accent-500">
              {email}
            </a>
          </div>
        )}
        {phone && (
          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span>{phone}</span>
          </div>
        )}
        {order.users?.id && (
          <div className="border-t border-border-default pt-1">
            <Link href={ap(`/admin/customers/${order.users.id}/view`)} className="text-xs font-medium text-accent-500 hover:text-accent-600">
              View customer profile
            </Link>
          </div>
        )}
      </div>
    </HoverCard>
  )
}

export default function OrdersTable({ orders, total, page, pageSize, backUrl, pageUrls }: { orders: any[]; total: number; page: number; pageSize: number; backUrl: string; pageUrls: PageUrls }) {
  const canPackingSlips = useHasScope('packing_slips:read')
  const [selected, setSelected] = useState<any>(null)
  const viewHref = (o: any) => ap(`/admin/orders/${o.id}/view?back=${encodeURIComponent(backUrl)}`)

  const cols: DataCol<any>[] = [
    {
      key: 'order_number',
      label: 'Order ID',
      sortParam: 'order_number',
      render: o => (
        <div className="flex items-center gap-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          <HoverCard
            trigger={
              <a href={viewHref(o)} className="font-mono font-semibold text-accent-500 underline decoration-dotted underline-offset-2 hover:text-accent-600" onClick={e => e.stopPropagation()}>
                #{o.order_number || o.id.slice(0, 8)}
              </a>
            }
            align="left"
            side="bottom"
            width="260px"
          >
            <div className="space-y-2 p-3">
              <p className="font-mono text-sm font-semibold text-foreground">#{o.order_number || o.id.slice(0, 8)}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <span className="text-foreground-muted">Customer</span>
                <span className="truncate font-medium text-foreground">{customerName(o)}</span>
                <span className="text-foreground-muted">Date</span>
                <span className="text-foreground">{new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <span className="text-foreground-muted">Total</span>
                <span className="font-semibold text-foreground">{inr(o.total_amount)}</span>
                <span className="text-foreground-muted">Payment</span>
                <span>
                  <StatusBadge status={o.payment_status} map={PAYMENT_STATUS_FULL} />
                </span>
                <span className="text-foreground-muted">Source</span>
                <span className="text-foreground">{sourceLabel(o.source)}</span>
              </div>
            </div>
          </HoverCard>
          <SubscriptionOrderBadge subscriptionId={o.subscription_id} cycle={o.subscription_cycle} />
        </div>
      ),
    },
    { key: 'source', label: 'Source', sortParam: 'source', hideBelow: 'lg', render: o => <Badge tone={sourceTone(o.source)}>{sourceLabel(o.source)}</Badge> },
    {
      key: 'customer',
      label: 'Customer',
      sortParam: 'customer',
      render: o => (
        <div className="min-w-0">
          <CustomerPopover order={o} />
          <div className="mt-0.5 max-w-[220px] truncate text-xs text-foreground-muted">{o.users?.email || o.billing_email}</div>
        </div>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      sortParam: 'date',
      render: o => (
        <div className="whitespace-nowrap">
          <div className="text-sm text-foreground">{new Date(o.created_at).toLocaleDateString('en-IN')}</div>
          <div className="text-xs text-foreground-muted">{new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</div>
        </div>
      ),
    },
    {
      key: 'edd',
      label: 'EDD',
      hideBelow: 'lg',
      render: o =>
        o.estimated_delivery_date ? (
          <span className="whitespace-nowrap text-sm text-foreground">{new Date(o.estimated_delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        ) : (
          <span className="text-foreground-muted">-</span>
        ),
    },
    { key: 'total', label: 'Total', sortParam: 'total', num: true, render: o => <span className="font-medium text-foreground">{inr(o.total_amount)}</span> },
    { key: 'payment', label: 'Payment', sortParam: 'payment', hideBelow: 'lg', render: o => <StatusBadge status={o.payment_status} map={PAYMENT_STATUS_FULL} /> },
    { key: 'status', label: 'Status', sortParam: 'status', render: o => <StatusBadge status={o.status} map={ORDER_STATUS_FULL} /> },
  ]

  return (
    <>
      <DataTable<any>
        mode="server"
        rows={orders}
        cols={cols}
        rowKey={o => o.id}
        total={total}
        page={page}
        pageSize={pageSize}
        pageHref={pageHrefFrom(pageUrls)}
        onRowClick={setSelected}
        mobile={rows => <OrdersMobileList orders={rows} backUrl={backUrl} />}
        empty="No orders found."
        rowActions={o => [
          { key: 'packing-slip', kind: 'print', label: 'Packing Slip', href: `/api/admin/packing-slips/${o.id}`, target: '_blank', hidden: !canPackingSlips },
          { key: 'shipping-label', kind: 'print', label: 'Shipping Label', href: `/api/admin/orders/${o.id}/shipping-label?size=4R&print=1`, target: '_blank', hidden: !o.awb_number },
          { key: 'invoice', kind: 'document', label: 'Invoice PDF', href: `/api/orders/${o.id}/invoice`, target: '_blank', hidden: !o.invoice_number },
          { key: 'view', kind: 'view', label: 'View Details', href: viewHref(o) },
        ]}
      />
      <OrderDetailModal order={selected} onClose={() => setSelected(null)} />
    </>
  )
}
