import type { PoolClient } from 'pg'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { isInterState, round2 } from '@/lib/gst'
import { transitDays } from '@/lib/edd'
import { getFeatureFlags, getBusinessValues } from '@/lib/site-controls'

export interface AddressSnapshot {
  full_name: string
  phone: string
  address_line1: string
  address_line2: string | null
  landmark: string | null
  city: string
  state: string
  postal_code: string
  country: string | null
}

// Same keys order creation writes into orders.shipping_address_snapshot.
const SNAPSHOT_FIELDS = [
  'full_name',
  'phone',
  'address_line1',
  'address_line2',
  'landmark',
  'city',
  'state',
  'postal_code',
  'country',
] as const

export const ADDRESS_SNAPSHOT_COLUMNS = SNAPSHOT_FIELDS.join(', ')

export function snapshotAddress(row: Record<string, unknown>): AddressSnapshot {
  const out: Record<string, unknown> = {}
  for (const f of SNAPSHOT_FIELDS) out[f] = row[f] ?? null
  return out as unknown as AddressSnapshot
}

const norm = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()

type AddressFields = Partial<Record<(typeof SNAPSHOT_FIELDS)[number], unknown>>

export function sameAddress(a: AddressFields | null | undefined, b: AddressFields | null | undefined): boolean {
  if (!a || !b) return false
  return SNAPSHOT_FIELDS.every(f => norm(a[f]) === norm(b[f]))
}

interface EligibilityFields {
  status: string
  awb_number?: string | null
  irn?: string | null
  irn_status?: string | null
  eway_bill_no?: string | null
}

// An IRN and an e-way bill are government-registered documents carrying the ship-to address,
// and both can be issued while an order is still confirmed — so either one locks the address.
export function addressChangeBlockReason(order: EligibilityFields): string | null {
  if (order.status !== 'confirmed') return 'The delivery address can only be changed while the order is confirmed.'
  if (order.awb_number) return 'A shipment has already been created for this order.'
  if (order.irn && order.irn_status !== 'cancelled') return 'An e-invoice has already been issued for this order.'
  if (order.eway_bill_no) return 'An e-way bill has already been issued for this order.'
  return null
}

// Tolerant of a tenant database the schema fan-out has not reached yet: a missing table must
// never block an order from moving to processing.
export async function hasPendingAddressChange(orderId: string): Promise<boolean> {
  try {
    const row = await queryOne(
      `SELECT id FROM address_change_requests WHERE order_id = $1 AND status = 'pending' LIMIT 1`,
      [orderId]
    )
    return !!row
  } catch {
    return false
  }
}

export interface AddressChangeRequestRow {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  old_address_snapshot: AddressSnapshot | null
  new_address_snapshot: AddressSnapshot
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export async function listAddressChangeRequests(orderId: string): Promise<AddressChangeRequestRow[]> {
  try {
    return await queryMany<AddressChangeRequestRow>(
      `SELECT id, status, old_address_snapshot, new_address_snapshot, admin_notes, created_at, reviewed_at
         FROM address_change_requests WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    )
  } catch {
    return []
  }
}

export function resplitTax(totalTax: number, isIgst: boolean): { cgst: number; sgst: number; igst: number } {
  const total = round2(totalTax)
  if (isIgst) return { cgst: 0, sgst: 0, igst: total }
  const cgst = round2(total / 2)
  return { cgst, sgst: round2(total - cgst), igst: 0 }
}

export type ApplyAddressChangeResult =
  | { applied: true; orderNumber: string; userId: string | null; newAddress: AddressSnapshot; gstSplitChanged: boolean }
  | {
      applied: false
      reason: 'not_found' | 'not_pending' | 'order_not_found' | 'order_not_eligible' | 'address_changed'
      message: string
    }

const num = (v: unknown) => Number(v || 0)

// GST place of supply is where delivery terminates, so the CGST/SGST vs IGST split follows the
// new state. Taxable value and total tax do not depend on the split, so only the split moves.
async function resplitOrderTax(
  client: PoolClient,
  orderId: string,
  order: Record<string, unknown>,
  isIgst: boolean
): Promise<void> {
  const items = await client.query(
    `SELECT id, cgst_amount, sgst_amount, igst_amount FROM order_items WHERE order_id = $1`,
    [orderId]
  )
  let cgst = 0,
    sgst = 0,
    igst = 0
  for (const it of items.rows) {
    const split = resplitTax(num(it.cgst_amount) + num(it.sgst_amount) + num(it.igst_amount), isIgst)
    cgst += split.cgst
    sgst += split.sgst
    igst += split.igst
    await client.query(`UPDATE order_items SET cgst_amount = $1, sgst_amount = $2, igst_amount = $3 WHERE id = $4`, [
      split.cgst,
      split.sgst,
      split.igst,
      it.id,
    ])
  }
  const totals =
    cgst + sgst + igst > 0
      ? { cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst) }
      : resplitTax(num(order.cgst_amount) + num(order.sgst_amount) + num(order.igst_amount), isIgst)
  await client.query(
    `UPDATE orders SET is_igst = $1, cgst_amount = $2, sgst_amount = $3, igst_amount = $4 WHERE id = $5`,
    [isIgst, totals.cgst, totals.sgst, totals.igst, orderId]
  )
}

export async function applyAddressChange(params: {
  requestId: string
  orderId: string
  adminId: string
  adminNotes?: string | null
}): Promise<ApplyAddressChangeResult> {
  const { requestId, orderId, adminId } = params
  const { gstEnabled } = await getFeatureFlags()
  const bv = await getBusinessValues()

  return withTransaction(async (client: PoolClient): Promise<ApplyAddressChangeResult> => {
    const reqRes = await client.query(
      `SELECT * FROM address_change_requests WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [requestId, orderId]
    )
    const req = reqRes.rows[0]
    if (!req) return { applied: false, reason: 'not_found', message: 'Address change request not found.' }
    if (req.status !== 'pending') {
      return { applied: false, reason: 'not_pending', message: `This request has already been ${req.status}.` }
    }

    const ordRes = await client.query(
      `SELECT id, order_number, user_id, status, awb_number, irn, irn_status, eway_bill_no,
              is_igst, cgst_amount, sgst_amount, igst_amount
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    )
    const order = ordRes.rows[0]
    if (!order) return { applied: false, reason: 'order_not_found', message: 'Order not found.' }
    const blocked = addressChangeBlockReason(order)
    if (blocked) return { applied: false, reason: 'order_not_eligible', message: blocked }

    // Apply only what the customer asked for and the admin reviewed: if the saved address was
    // edited or removed since, the live row no longer matches the request.
    const addrRes = req.new_address_id
      ? await client.query(`SELECT ${ADDRESS_SNAPSHOT_COLUMNS} FROM addresses WHERE id = $1`, [req.new_address_id])
      : { rows: [] }
    const live = addrRes.rows[0]
    if (!live || !sameAddress(live, req.new_address_snapshot)) {
      return {
        applied: false,
        reason: 'address_changed',
        message:
          'The customer has edited or removed this saved address since making the request. Reject it and ask them to submit a new request.',
      }
    }
    const newAddress = snapshotAddress(live)

    const oldPin = String(req.old_address_snapshot?.postal_code ?? '')
    const eddShift =
      transitDays(newAddress.postal_code, bv.delhiveryOriginPincode) - transitDays(oldPin, bv.delhiveryOriginPincode)

    await client.query(
      `UPDATE orders SET
         shipping_address_id = $1,
         shipping_address_snapshot = $2,
         estimated_delivery_date = estimated_delivery_date + $3::int,
         updated_at = NOW()
       WHERE id = $4`,
      [req.new_address_id, JSON.stringify(newAddress), eddShift, orderId]
    )

    let gstSplitChanged = false
    if (gstEnabled) {
      const isIgst = isInterState(newAddress.state || '', bv.businessStateCode)
      if (isIgst !== !!order.is_igst) {
        await resplitOrderTax(client, orderId, order, isIgst)
        gstSplitChanged = true
      }
    }

    // A PDF already cached for this invoice still carries the old address.
    await client.query(`UPDATE invoices SET pdf_url = NULL WHERE order_id = $1`, [orderId])

    await client.query(
      `UPDATE address_change_requests
          SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), admin_notes = $2, updated_at = NOW()
        WHERE id = $3`,
      [adminId, params.adminNotes?.trim() || null, requestId]
    )

    return {
      applied: true,
      orderNumber: order.order_number,
      userId: order.user_id ?? null,
      newAddress,
      gstSplitChanged,
    }
  })
}
