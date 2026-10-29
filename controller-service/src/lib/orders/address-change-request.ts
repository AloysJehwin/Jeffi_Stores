import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { checkPincodeServiceability } from '@/lib/shipping/delhivery'
import { logActivity } from '@/lib/shared/activity'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { addressChangeBlockReason, snapshotAddress, sameAddress, ADDRESS_SNAPSHOT_COLUMNS, type AddressSnapshot } from './address-change'

// A customer's request to deliver a confirmed order to another saved address (storefront route and
// the support assistant). The caller has already checked the customer may open the order.

export type AddressChangeSubmit =
  | { ok: true; request: { id: string; status: 'pending'; newAddress: AddressSnapshot; adminNotes: null; createdAt: string } }
  | { ok: false; status: number; error: string; unserviceable?: boolean }

export const ORDER_ADDRESS_SELECT = `
  SELECT o.id, o.order_number, o.user_id, o.status, o.awb_number, o.irn, o.irn_status, o.eway_bill_no,
         o.payment_mode, o.payment_status, o.shipping_address_id, o.customer_name,
         COALESCE(
           o.shipping_address_snapshot,
           (SELECT to_jsonb(a) FROM (SELECT ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = o.shipping_address_id) a)
         ) AS current_address
    FROM orders o`

export async function submitAddressChange(order: any, addressId: string, userId: string): Promise<AddressChangeSubmit> {
  const blocked = addressChangeBlockReason(order)
  if (blocked) return { ok: false, status: 400, error: blocked }

  const address = await queryOne<any>(`SELECT id, ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`, [addressId, userId])
  if (!address) return { ok: false, status: 404, error: 'Address not found' }

  const newAddress = snapshotAddress(address)
  if (sameAddress(newAddress, order.current_address)) {
    return { ok: false, status: 400, error: 'This is already the delivery address for this order.' }
  }

  // Same gate checkout applies, so an address change cannot route around it.
  if (String(newAddress.postal_code) !== String(order.current_address?.postal_code ?? '')) {
    const service = await checkPincodeServiceability(newAddress.postal_code)
    if (!service.serviceable) {
      return { ok: false, status: 422, error: service.error || 'Delivery is not available to this pincode.', unserviceable: true }
    }
    const isCod = order.payment_mode === 'cod' || String(order.payment_status || '').startsWith('cod')
    if (isCod && !service.cod) return { ok: false, status: 422, error: 'Cash on delivery is not available to this pincode.' }
  }

  let created: { id: string; created_at: string } | null
  try {
    created = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO address_change_requests
         (order_id, requested_by_user_id, old_address_id, new_address_id, old_address_snapshot, new_address_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        order.id,
        userId,
        order.shipping_address_id ?? null,
        address.id,
        order.current_address ? JSON.stringify(snapshotAddress(order.current_address)) : null,
        JSON.stringify(newAddress),
      ]
    )
  } catch (err: any) {
    if (err?.code === '23505') return { ok: false, status: 409, error: 'An address change request is already pending for this order.' }
    throw err
  }

  logActivity({
    userId,
    kind: 'address_change',
    referenceId: order.id,
    referenceType: 'orders',
    summary: `Delivery address change requested for #${order.order_number}`,
    metadata: { requestId: created?.id, postalCode: newAddress.postal_code },
  }).catch(() => {})

  createAdminNotification({
    type: 'address_change_requested',
    category: 'orders',
    title: `Address change — #${order.order_number}`,
    message: `${order.customer_name || 'Customer'} asked to deliver to ${newAddress.city}, ${newAddress.state} ${newAddress.postal_code}`,
    link: `/admin/orders/${order.id}`,
    entityType: 'address_change',
    entityId: String(created?.id),
    severity: 'warning',
    scope: 'orders:read',
  }).catch(() => {})

  return { ok: true, request: { id: String(created?.id), status: 'pending', newAddress, adminNotes: null, createdAt: String(created?.created_at) } }
}
