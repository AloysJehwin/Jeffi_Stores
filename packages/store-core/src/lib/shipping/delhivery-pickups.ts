import 'server-only'
import { queryMany } from '@/lib/shared/db'

// Orders with an AWB not yet in a pickup request, and recent pickup requests: the Delhivery
// Pickups tab, its API and its exports.

export const EXCLUDE_STATUSES = [
  'shipped',
  'delivered',
  'granted',
  'cancelled',
  'returned',
  'return_requested',
  'return_approved',
  'return_received',
  'return_rejected',
]

export async function loadPickupLists() {
  const [orders, pickupHistory] = await Promise.all([
    queryMany(
      `
        SELECT o.id, o.order_number, o.awb_number, o.status, o.created_at,
               o.customer_name, sa.city, sa.state, sa.postal_code
        FROM orders o
        LEFT JOIN addresses sa ON sa.id = o.shipping_address_id
        WHERE o.awb_number IS NOT NULL
          AND o.payment_status = 'paid'
          AND o.status NOT IN (${EXCLUDE_STATUSES.map((_, i) => `$${i + 1}`).join(', ')})
          AND o.awb_number NOT IN (
            SELECT UNNEST(awbs) FROM delhivery_pickup_requests
            WHERE pickup_status IN ('pending', 'picked_up')
          )
        ORDER BY o.created_at DESC
        LIMIT 100
      `,
      [...EXCLUDE_STATUSES]
    ),
    queryMany(
      `
        SELECT id, pickup_id, pickup_date, awb_count, awbs, raw_response, pickup_status, created_at
        FROM delhivery_pickup_requests
        ORDER BY created_at DESC
        LIMIT 20
      `,
      []
    ),
  ])
  return { orders: orders || [], pickupHistory: pickupHistory || [] }
}
