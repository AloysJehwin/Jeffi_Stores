import type { OrderDetails, ReturnInfo } from '../../api/account'
import { absUrl } from '../../lib/links'

// Constants and formatters the order detail sections share.

const ROOT_DOMAIN = (process.env.EXPO_PUBLIC_ROOT_DOMAIN || 'jeffistores.in').replace(/^\.+|\/+$/g, '')

export const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'processing']
export const RETURN_STATUSES = ['return_requested', 'return_approved', 'return_received', 'return_rejected', 'returned']
export const DAY = 24 * 60 * 60 * 1000
export const REASONS = [
  { value: 'defective', label: 'Defective product' },
  { value: 'wrong_item', label: 'Wrong item sent' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'damaged', label: 'Damaged in transit' },
  { value: 'other', label: 'Other' },
]

export type Order = OrderDetails
export type OrderItem = OrderDetails['items'][number]
export type ReturnRequest = NonNullable<ReturnInfo['returnRequest']>
export type RefundBreakdown = ReturnInfo['refundBreakdown']

export const inrCur = (n: number) => Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })
export const inrPlain = (n: number | string) => parseFloat(String(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 })
export const fmtQty = (q: number) => Number(Number(q).toFixed(3)).toString()
export const unitText = (label: string | null) => (label ? label.replace(/^(.+?)2$/, '$1²') : '')
export const invoiceUrl = (slug: string | null, token: string) => `https://${slug ? `invoice-${slug}` : 'invoice'}.${ROOT_DOMAIN}/${token}`

export function thumbOf(item: OrderItem) {
  const img = item.products?.product_images?.find(i => i.is_primary) || item.products?.product_images?.[0]
  return img ? absUrl(img.thumbnail_url || img.image_url) : null
}

export function resolveOrderEdd(order: Order): string | null {
  if (!order.estimatedDeliveryDate) return null
  return new Date(order.estimatedDeliveryDate + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })
}

export function getEddDisplay(order: Order, edd: string): { label: string; sub: string; color: string } {
  if (order.status === 'delivered')
    return {
      label: 'Delivered',
      sub: order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : edd,
      color: 'text-green-600 dark:text-green-400',
    }
  if (order.status === 'out_for_delivery') return { label: 'Arriving Today', sub: 'Out for delivery', color: 'text-accent-600 dark:text-accent-400' }
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  todayIST.setHours(0, 0, 0, 0)
  const eddDate = new Date(String(order.estimatedDeliveryDate).slice(0, 10) + 'T00:00:00Z')
  const diffDays = Math.round((eddDate.getTime() - todayIST.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Arriving Today', sub: edd, color: 'text-accent-600 dark:text-accent-400' }
  if (diffDays === 1) return { label: 'Arriving Tomorrow', sub: edd, color: 'text-accent-600 dark:text-accent-400' }
  if (diffDays < 0) return { label: 'Expected by ' + edd, sub: 'Delivery delayed', color: 'text-orange-600 dark:text-orange-400' }
  if (order.courierEdd && order.courierEdd === String(order.estimatedDeliveryDate).slice(0, 10)) return { label: 'Expected by ' + edd, sub: 'Courier estimate', color: 'text-foreground' }
  return { label: 'Estimated Delivery', sub: edd, color: 'text-foreground' }
}

/** The order's return / replacement eligibility, from its items' windows and the store's monthly limit. */
export function returnEligibility(order: Order, returnRequest: ReturnRequest | null, monthlyLimitReached: boolean) {
  const deliveryTs = (() => {
    const d = order.deliveredAt || order.updatedAt
    return d ? new Date(d).getTime() : 0
  })()
  const delivered = order.status === 'delivered' && !returnRequest && order.items.length > 0 && !!deliveryTs
  const canRefund = delivered && order.items.some(i => i.returnAllowed && Date.now() <= deliveryTs + i.returnWindowDays * DAY)
  const canReplace = delivered && order.items.some(i => i.replacementAllowed && Date.now() <= deliveryTs + i.replacementWindowDays * DAY)
  const canReturn = !monthlyLimitReached && (canRefund || canReplace)
  const returnWindowExpired =
    delivered &&
    !monthlyLimitReached &&
    !(canRefund || canReplace) &&
    (() => {
      const eligible = order.items.filter(i => i.returnAllowed || i.replacementAllowed)
      return eligible.length > 0 && eligible.every(i => Date.now() > deliveryTs + Math.max(i.returnWindowDays, i.replacementWindowDays) * DAY)
    })()
  return { deliveryTs, canRefund, canReplace, canReturn, returnWindowExpired }
}

export const returnTitle = (canRefund: boolean, canReplace: boolean) =>
  canRefund && canReplace ? 'Request Return / Replacement' : canRefund ? 'Request Return' : 'Request Replacement'
