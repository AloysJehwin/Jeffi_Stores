'use client'

import { useEffect, useCallback, useState } from 'react'
import Link from 'next/link'
import { Calendar, FileText, Printer, Truck } from 'lucide-react'
import { useHasScope } from '@/contexts/AdminScopesContext'
import ProductWarningBadges from '@/components/shared/ProductWarningBadges'
import { ap } from '@/lib/shared/admin-path'
import CopySku from '@/components/ui/CopySku'
import { fmtQty } from '@/lib/shared/number-display'
import { Badge, Dialog, Field, Fields, StatusBadge } from '@/components/admin/kit'
import { ORDER_STATUS_FULL, PAYMENT_STATUS_FULL, inr, sourceLabel, sourceTone } from './status-maps'

// The stored EDD is the only source: computeEdd at order time, then courier/admin updates.
function resolveOrderEdd(o: any): string | null {
  const raw = o.estimated_delivery_date
  if (!raw) return null
  return new Date(String(raw).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

interface Props {
  order: any | null
  onClose: () => void
}

const linkBtn = 'control-sm border border-border-default bg-surface-secondary text-xs font-semibold text-foreground hover:bg-surface-secondary/70'

export default function OrderDetailModal({ order, onClose }: Props) {
  const canPackingSlips = useHasScope('packing_slips:read')
  const [detail, setDetail] = useState<{ order: any; items: any[] } | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/admin/orders/${id}`)
      if (res.ok) setDetail(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (order) fetchDetail(order.id)
  }, [order, fetchDetail])

  const o = detail?.order || order
  const items: any[] = detail?.items || []
  const orderNum = o ? o.order_number || o.id.slice(0, 8) : ''
  const customer = o
    ? o.users
      ? `${o.users.first_name || ''} ${o.users.last_name || ''}`.trim() || o.customer_name || 'Guest'
      : o.customer_name || 'Guest'
    : ''
  const addr = o?.shipping_address || o?.billing_address
  // Only an all-digital order reaches 'granted', so it has nothing to pack or ship.
  const isAllDigital = o?.status === 'granted'
  const edd = o && !isAllDigital ? resolveOrderEdd(o) : null

  return (
    <Dialog
      open={!!order}
      onClose={onClose}
      size="xl"
      zIndex="z-[300]"
      title={<span className="font-mono">#{orderNum}</span>}
      description={
        o &&
        `${new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
      }
      footer={
        order && (
          <>
            {canPackingSlips && !isAllDigital && (
              <a href={`/api/admin/packing-slips/${order.id}`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                <Printer className="h-3.5 w-3.5" /> Packing Slip
              </a>
            )}
            {o?.awb_number && (
              <a href={`/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                <Truck className="h-3.5 w-3.5" /> Shipping Label
              </a>
            )}
            {o?.invoice_number && (
              <a href={`/api/orders/${order.id}/invoice`} target="_blank" rel="noopener noreferrer" className={linkBtn}>
                <FileText className="h-3.5 w-3.5" /> Invoice PDF
              </a>
            )}
            <Link href={ap(`/admin/orders/${order.id}/view`)} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600">
              Full Details
            </Link>
          </>
        )
      }
    >
      {o && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={o.status} map={ORDER_STATUS_FULL} />
            <StatusBadge status={o.payment_status} map={PAYMENT_STATUS_FULL} />
            <Badge tone={sourceTone(o.source)}>{sourceLabel(o.source)}</Badge>
            {edd && (
              <Badge tone="blue">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> EDD: {edd}
                </span>
              </Badge>
            )}
          </div>

          <Fields>
            <Field
              label="Customer"
              value={
                <div>
                  <p className="font-semibold">{customer}</p>
                  {(o.users?.email || o.billing_email) && <p className="text-xs text-foreground-secondary">{o.users?.email || o.billing_email}</p>}
                  {(o.users?.phone || o.billing_address?.phone) && <p className="text-xs text-foreground-secondary">{o.users?.phone || o.billing_address?.phone}</p>}
                  {o.users?.id && (
                    <Link href={ap(`/admin/customers/${o.users.id}/view`)} className="mt-1 inline-block text-xs text-accent-500 hover:underline">
                      View customer
                    </Link>
                  )}
                </div>
              }
            />
            <Field
              label="Shipping address"
              value={addr ? [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ') : null}
            />
          </Fields>

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-secondary p-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-foreground-muted">Subtotal</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">{inr(o.subtotal)}</p>
            </div>
            {Number(o.discount_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">Discount</p>
                <p className="text-sm font-semibold tabular-nums text-red-500">-{inr(o.discount_amount)}</p>
              </div>
            )}
            {Number(o.business_discount_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">Business Discount</p>
                <p className="text-sm font-semibold tabular-nums text-red-500">-{inr(o.business_discount_amount)}</p>
              </div>
            )}
            {Number(o.shipping_amount) > 0 && (
              <div>
                <p className="text-xs text-foreground-muted">Shipping</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">{inr(o.shipping_amount)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Total</p>
              <p className="text-sm font-bold tabular-nums text-foreground">{inr(o.total_amount)}</p>
            </div>
          </div>

          {items.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-foreground-muted">Items ({items.length})</p>
              <div className="overflow-x-auto rounded-lg border border-border-default">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border-default bg-surface-secondary/50 text-xs text-foreground-muted">
                      <th className="w-[45%] px-3 py-2 text-left font-medium">Product</th>
                      <th className="w-[15%] px-3 py-2 text-left font-medium">SKU</th>
                      <th className="w-[12%] px-3 py-2 text-right font-medium">Qty</th>
                      <th className="w-[14%] px-3 py-2 text-right font-medium">Unit</th>
                      <th className="w-[14%] px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => (
                      <tr key={item.id} className="border-b border-border-default/60 last:border-0 hover:bg-surface-secondary/40">
                        <td className="px-3 py-2 font-medium text-foreground">
                          <p className="truncate" title={item.product_name}>
                            {item.product_name}
                          </p>
                          {item.variant_name && <p className="truncate text-xs text-foreground-muted">{item.variant_name}</p>}
                          <ProductWarningBadges fragile={item.fragile} hazardous={item.hazardous} flammable={item.flammable} size="xs" />
                          {item.is_digital && (
                            <span className="mt-0.5 inline-block">
                              <Badge tone="green">Digital</Badge>
                            </span>
                          )}
                        </td>
                        <td className="truncate px-3 py-2 text-xs text-foreground-muted">
                          <span className="inline-flex items-center gap-1">
                            {item.product_sku || '-'}
                            {item.product_sku && <CopySku sku={item.product_sku} />}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtQty(item.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">₹{Number(item.unit_price).toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">₹{Number(item.total_price).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {loading && !detail && <p className="text-center text-xs text-foreground-muted">Loading details...</p>}
        </div>
      )}
    </Dialog>
  )
}
