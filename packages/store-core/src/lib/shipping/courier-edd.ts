import { query } from '@/lib/shared/db'

/**
 * Courier (Delhivery) expected delivery date.
 *
 * Rule: orders.estimated_delivery_date is the one date customers and admins see. It starts as our
 * promise (computeEdd at checkout). Once Delhivery reports an expected date it is mirrored into
 * orders.courier_edd and, whenever that courier date CHANGES, copied onto estimated_delivery_date.
 * An unchanged courier date never rewrites it, so an admin's manual "Change EDD" holds until
 * Delhivery revises its estimate. Nothing is written once the order is delivered/returned or the
 * shipment is on its way back (RTO), whose dates refer to the return leg.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return dt.toISOString().slice(0, 10)
}

/**
 * Normalise a Delhivery date to `YYYY-MM-DD` (IST calendar day). Accepts ISO dates/datetimes
 * (`2026-10-23`, `2026-10-23T23:59:59`, `2026-10-23 23:59:59.000`, with `Z`/offset → converted to
 * IST), `23-10-2026` / `23/10/2026` (day first, optional time) and `23 Oct 2026`. Anything else → null.
 */
export function parseCourierDate(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i)
  if (m) {
    if (m[7] && m[4] != null) {
      const off = m[7].toUpperCase() === 'Z' ? 'Z' : m[7].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2')
      const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${off}`)
      if (Number.isNaN(t)) return null
      return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    }
    return ymd(+m[1], +m[2], +m[3])
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ,]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i)
  if (m) return ymd(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})/)
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  return null
}

/**
 * The courier's expected date from a Delhivery packages/json `Shipment`. The revised
 * ExpectedDeliveryDate wins; PromisedDeliveryDate (set at manifest, often the only one present
 * early on) is the fallback. Casing variants seen across Delhivery APIs are tolerated.
 */
export function extractCourierEdd(shipment: any): string | null {
  if (!shipment || typeof shipment !== 'object') return null
  const keys = [
    'ExpectedDeliveryDate',
    'expectedDeliveryDate',
    'expected_delivery_date',
    'expected_date',
    'PromisedDeliveryDate',
    'promisedDeliveryDate',
    'promised_delivery_date',
  ]
  for (const k of keys) {
    const d = parseCourierDate(shipment[k])
    if (d) return d
  }
  return null
}

const CLOSED_STATUSES = ['delivered', 'granted', 'cancelled', 'returned', 'return_received', 'refunded']
const FROZEN_SHIPMENT = ['delivered', 'rto_initiated', 'rto_in_transit', 'rto_out_for_return', 'rto_delivered']

/**
 * Record the courier EDD on an order (see the rule above). shipmentStatus is the freshly resolved
 * stage; a delivered/RTO stage skips the write even before the order row catches up.
 * Returns true when a row changed.
 */
export async function applyCourierEdd(
  orderId: string,
  courierEdd: string | null,
  shipmentStatus?: string | null
): Promise<boolean> {
  if (!courierEdd) return false
  if (shipmentStatus && FROZEN_SHIPMENT.includes(shipmentStatus)) return false
  const res = await query(
    `UPDATE orders SET
       courier_edd = $2::date,
       courier_edd_updated_at = NOW(),
       estimated_delivery_date = $2::date,
       updated_at = NOW()
     WHERE id = $1
       AND courier_edd IS DISTINCT FROM $2::date
       AND delivered_at IS NULL
       AND status <> ALL($3::text[])
       AND COALESCE(shipment_status, '') <> ALL($4::text[])`,
    [orderId, courierEdd, CLOSED_STATUSES, FROZEN_SHIPMENT]
  )
  return (res?.rowCount ?? 0) > 0
}
