import 'server-only'
import { queryMany } from '@/lib/shared/db'
import { round2 } from '@/lib/catalog/gst'
import { SUBSCRIPTION_INTERVAL_LABELS, SUBSCRIPTION_STATUS_LABELS, isSubscriptionInterval } from './intervals'

export interface CustomerSubscriptionItem {
  id: string
  status: string
  statusLabel: string
  productId: string
  productName: string
  productSlug: string
  imageUrl: string | null
  isDigital: boolean
  interval: string | null
  intervalLabel: string
  quantity: number
  amount: number
  currentCycle: number
  /** Fixed number of charges, or null = until cancelled. */
  totalCycles: number | null
  minCycles: number | null
  currentEnd: string | null
  nextChargeAt: string | null
  cancelAtCycleEnd: boolean
  accessExpiresAt: string | null
  address: { name: string; line1: string; city: string; state: string; pincode: string } | null
  orders: Array<{ id: string; orderNumber: string; status: string; total: number; createdAt: string; cycle: number | null }>
}

const CHARGEABLE = new Set(['active', 'authenticated', 'pending'])

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

/** The caller's non-legacy subscriptions (optionally one), in the customer API item shape. */
export async function loadCustomerSubscriptions(userId: string, id?: string): Promise<CustomerSubscriptionItem[]> {
  const rows = await queryMany<any>(
    `SELECT s.*, p.name AS product_name, p.slug AS product_slug,
            COALESCE(p.image_url,
              (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id
                ORDER BY pi.is_primary DESC NULLS LAST, pi.display_order ASC NULLS LAST LIMIT 1)) AS image_url
       FROM subscriptions s JOIN products p ON p.id = s.product_id
      WHERE s.user_id = $1 AND COALESCE(s.source, 'legacy') <> 'legacy'
        AND ($2::uuid IS NULL OR s.id = $2::uuid)
      ORDER BY s.created_at DESC`,
    [userId, id ?? null]
  )
  if (rows.length === 0) return []

  const orders = await queryMany<any>(
    `SELECT id, order_number, status, total_amount, created_at, subscription_id, subscription_cycle
       FROM orders WHERE subscription_id = ANY($1::uuid[]) AND user_id = $2
      ORDER BY subscription_cycle DESC NULLS LAST, created_at DESC`,
    [rows.map(r => r.id), userId]
  )

  return rows.map(r => {
    const qty = Number(r.quantity ?? 1)
    const amount = round2((Number(r.unit_price_paise ?? 0) * qty + Number(r.shipping_paise ?? 0)) / 100)
    const a = r.address_snapshot
    const interval = r.interval ?? null
    return {
      id: r.id,
      status: r.status,
      statusLabel: SUBSCRIPTION_STATUS_LABELS[r.status] ?? r.status,
      productId: r.product_id,
      productName: r.product_name,
      productSlug: r.product_slug,
      imageUrl: r.image_url ?? null,
      isDigital: r.is_digital === true,
      interval,
      intervalLabel: isSubscriptionInterval(interval) ? SUBSCRIPTION_INTERVAL_LABELS[interval] : (interval ?? ''),
      quantity: qty,
      amount,
      currentCycle: Number(r.current_cycle ?? 0),
      totalCycles: r.term_cycles != null ? Number(r.term_cycles) : null,
      minCycles: r.min_cycles != null ? Number(r.min_cycles) : null,
      currentEnd: iso(r.current_end),
      nextChargeAt: CHARGEABLE.has(r.status) && !r.cancel_at_cycle_end ? iso(r.current_end ?? r.next_renewal_at) : null,
      cancelAtCycleEnd: r.cancel_at_cycle_end === true,
      accessExpiresAt: iso(r.access_expires_at),
      address: a
        ? {
            name: a.full_name ?? '',
            line1: a.address_line1 ?? '',
            city: a.city ?? '',
            state: a.state ?? '',
            pincode: a.postal_code ?? '',
          }
        : null,
      orders: orders
        .filter(o => o.subscription_id === r.id)
        .map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          total: Number(o.total_amount),
          createdAt: iso(o.created_at)!,
          cycle: o.subscription_cycle ?? null,
        })),
    }
  })
}
