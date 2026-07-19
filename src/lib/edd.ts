/**
 * Estimated Delivery Date (EDD) — the single source of truth.
 *
 * EDD = today + TAT (calendar days), where
 *   TAT = handlingDays (dispatch/processing, min 2) + transitDays(pincode) + extraDays.
 *
 * This used to be duplicated (and drifting) across the checkout estimate API and
 * the three order-creation paths — buy-now/draft even dropped handlingDays, so a
 * placed order's EDD disagreed with the checkout preview. Everything now goes
 * through computeEdd() so preview and stored EDD always match.
 */

/**
 * 3-digit pincode prefixes treated as "metro" (faster transit). Includes metro
 * suburbs/satellite ranges — the fuller set, canonical for both preview and orders.
 */
export const METRO_PINS_3 = new Set<string>([
  // Delhi / NCR
  '110', '111', '112',
  // Mumbai (incl. suburbs, Thane, Navi Mumbai)
  '400', '401', '402', '403', '410', '421',
  // Bangalore / Bengaluru
  '560', '561', '562', '563',
  // Chennai
  '600', '601', '602', '603',
  // Hyderabad / Secunderabad
  '500', '501', '502', '503',
  // Kolkata
  '700', '711', '712',
  // Pune
  '411', '412', '413',
  // Ahmedabad
  '380', '382', '383',
])

/**
 * Courier transit days derived from the delivery pincode:
 *  - own region (Raipur / Chhattisgarh, `49…`) → 7
 *  - metro (see METRO_PINS_3) → 10
 *  - rest of India → 14
 *  - missing/invalid (not a 6-digit pin, e.g. address not yet chosen) → 7
 */
export function transitDays(pin: string): number {
  const p = String(pin ?? '')
  if (!/^\d{6}$/.test(p)) return 7
  if (p.startsWith('49')) return 7
  if (METRO_PINS_3.has(p.slice(0, 3))) return 10
  return 14
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Compute the EDD as a `YYYY-MM-DD` string (calendar days from now).
 * handlingDays is floored at 2 (minimum dispatch time); extraDays floored at 0.
 */
export function computeEdd(opts: { pin: string; handlingDays?: number; extraDays?: number }): string {
  const handling = Math.max(2, Number(opts.handlingDays ?? 2) || 0)
  const extra = Math.max(0, Number(opts.extraDays ?? 0) || 0)
  const tat = handling + transitDays(opts.pin) + extra
  return addDays(new Date(), tat).toISOString().slice(0, 10)
}
