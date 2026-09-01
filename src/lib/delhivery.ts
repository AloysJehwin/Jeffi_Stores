import { query } from '@/lib/db'
import { getBusinessValues } from '@/lib/site-controls'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'
const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'
const SELLER_NAME = process.env.DELHIVERY_SELLER_NAME || 'Jeffi Stores'
const SELLER_ADD = process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur'
const SELLER_PHONE = process.env.DELHIVERY_SELLER_PHONE || '07713585374'

export interface PincodeServiceability {
  serviceable: boolean
  pickup: boolean
  cod: boolean
  prepaid: boolean
  district?: string
  state?: string
  error?: string
}

/**
 * Delhivery pincode serviceability. Validates a pickup pincode at the point the owner types it,
 * rather than at provisioning where a bad one is only discovered long after they have left the
 * form — and where the step is skipped silently.
 *
 * Note this validates the PINCODE, not the address: a wrong house number still passes.
 * Never throws — an unreachable Delhivery must not block onboarding, so an error is reported
 * as "could not check" and the caller decides.
 */
export async function checkPincodeServiceability(pincode: string): Promise<PincodeServiceability> {
  const token = process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_TOKEN
  const pin = String(pincode ?? '').replace(/\D/g, '')
  if (!/^\d{6}$/.test(pin)) return { serviceable: false, pickup: false, cod: false, prepaid: false, error: 'A pincode is six digits.' }
  if (!token) return { serviceable: false, pickup: false, cod: false, prepaid: false, error: 'Delivery partner not configured.' }

  try {
    const res = await fetch(
      `https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=${pin}`,
      { headers: { Authorization: `Token ${token}`, Accept: 'application/json' }, cache: 'no-store' },
    )
    if (!res.ok) return { serviceable: false, pickup: false, cod: false, prepaid: false, error: `Could not check this pincode (${res.status}).` }
    const data = await res.json().catch(() => null)
    const entry = data?.delivery_codes?.[0]?.postal_code
    if (!entry) return { serviceable: false, pickup: false, cod: false, prepaid: false }
    const yes = (v: unknown) => String(v ?? '').toUpperCase() === 'Y' || v === true
    return {
      serviceable: true,
      pickup: yes(entry.pickup),
      cod: yes(entry.cod),
      prepaid: yes(entry.pre_paid),
      district: entry.district ?? undefined,
      state: entry.state_code ?? undefined,
    }
  } catch {
    return { serviceable: false, pickup: false, cod: false, prepaid: false, error: 'Could not reach the delivery partner.' }
  }
}

// Delhivery has no delete for a client warehouse — the edit endpoint is the only way to retire
// one, so we flip it inactive rather than removing the address. Keyed by warehouse name (the
// pickup_location). Best-effort / idempotent: a missing warehouse is treated as already gone.
export async function deactivateDelhiveryPickupLocation(name: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_TOKEN
  if (!token) return { ok: false, error: 'DELHIVERY_API_KEY not configured' }
  if (!name) return { ok: false, error: 'no pickup location name' }

  try {
    const res = await fetch('https://track.delhivery.com/api/backend/clientwarehouse/edit/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name, is_active: false, active: false }),
      cache: 'no-store',
    })

    const data = await res.json().catch(() => ({}))
    if (res.ok && data && data.success !== false) return { ok: true }

    const message = JSON.stringify(data).toLowerCase()
    if (message.includes('does not exist') || message.includes('not found')) return { ok: true }

    return { ok: false, error: data.error || data.rmk || `Delhivery warehouse deactivation failed (${res.status})` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createDelhiveryPickupLocation(params: {
  name: string
  phone: string
  pincode: string
  address: string
  registeredName?: string
  email?: string
  city?: string
  state?: string
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.DELHIVERY_API_KEY || process.env.DELHIVERY_TOKEN
  if (!token) return { ok: false, error: 'DELHIVERY_API_KEY not configured' }

  const { name, phone, pincode, address, registeredName, email, city, state } = params

  const body: Record<string, string> = {
    name,
    phone,
    address,
    country: 'India',
    pin: pincode,
    return_address: address,
    return_pin: pincode,
    return_country: 'India',
  }
  if (registeredName) body.registered_name = registeredName
  if (email) body.email = email
  if (city) {
    body.city = city
    body.return_city = city
  }
  if (state) {
    body.state = state
    body.return_state = state
  }

  try {
    const res = await fetch('https://track.delhivery.com/api/backend/clientwarehouse/create/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const data = await res.json().catch(() => ({}))
    const message = JSON.stringify(data).toLowerCase()

    if (res.ok && data && data.success !== false) {
      return { ok: true }
    }

    if (message.includes('already exists') || message.includes('duplicate') || message.includes('warehouse name')) {
      return { ok: true }
    }

    return { ok: false, error: data.error || data.rmk || `Delhivery warehouse creation failed (${res.status})` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function cancelDelhiveryShipment(awbNumber: string): Promise<void> {
  const token = process.env.DELHIVERY_API_KEY
  if (!token) throw new Error('DELHIVERY_API_KEY not configured')

  const res = await fetch(DELHIVERY_EDIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ waybill: awbNumber, cancellation: 'true' }),
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Delhivery cancellation failed (${res.status}): ${JSON.stringify(data)}`)
  }

  await query('UPDATE orders SET awb_number = NULL WHERE awb_number = $1', [awbNumber])
}

export async function createRVPShipment(params: {
  consigneeName: string
  address: string
  pin: string
  city: string
  state: string
  phone: string
  invoiceRef: string
  totalAmount: string
  orderDate: string
  weightKg: number
  productDesc: string
  quantity: number
}): Promise<string> {
  const token = process.env.DELHIVERY_API_KEY
  if (!token) throw new Error('DELHIVERY_API_KEY not configured')

  const bv = await getBusinessValues()
  const ORIGIN_PIN = bv.delhiveryOriginPincode
  const PICKUP_LOCATION = bv.pickupLocation
  const SELLER_NAME = bv.sellerName
  const SELLER_ADD = bv.sellerAddress
  const SELLER_PHONE = bv.sellerPhone

  const {
    consigneeName, address, pin, city, state,
    invoiceRef, totalAmount, orderDate, weightKg, productDesc, quantity,
  } = params

  const rawPhone = params.phone.replace(/\D/g, '')
  const phone = rawPhone.length === 12 && rawPhone.startsWith('91') ? rawPhone.slice(2) : rawPhone.slice(-10)

  const shipmentPayload = {
    shipments: [{
      name: consigneeName,
      add: address,
      pin,
      city,
      state,
      country: 'India',
      phone,
      order: `RVP-${invoiceRef}`,
      payment_mode: 'Pickup',
      order_type: 'reverse',
      return_name: SELLER_NAME,
      return_pin: ORIGIN_PIN,
      return_city: 'Raipur',
      return_phone: SELLER_PHONE,
      return_add: SELLER_ADD,
      return_state: 'Chhattisgarh',
      return_country: 'India',
      products_desc: productDesc,
      hsn_code: '7318',
      cod_amount: '0',
      order_date: orderDate,
      total_amount: totalAmount,
      seller_add: SELLER_ADD,
      seller_name: SELLER_NAME,
      seller_inv: invoiceRef,
      quantity: String(quantity),
      waybill: '',
      shipment_width: '15',
      shipment_height: '15',
      shipment_length: '20',
      weight: String(weightKg),
      qc_type: 'non_param',
    }],
    pickup_location: { name: PICKUP_LOCATION },
  }

  const formData = new URLSearchParams()
  formData.append('format', 'json')
  formData.append('data', JSON.stringify(shipmentPayload))

  const res = await fetch(DELHIVERY_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok || !data.packages || data.packages.length === 0) {
    throw new Error(data.rmk || 'Delhivery RVP creation failed')
  }

  const pkg = data.packages[0]
  if (pkg.status === 'Fail' || pkg.err_code) {
    throw new Error(pkg.remarks?.join('; ') || `RVP creation failed (${pkg.err_code})`)
  }

  if (!pkg.waybill) {
    throw new Error('No AWB returned by Delhivery')
  }

  return pkg.waybill as string
}

export interface DelhiveryInvoiceCharges {
  total: number
  freight: number
  codCharge: number
  oda: number
  /** Pre-tax amount; total includes GST. */
  gross: number
  tax: number
  chargedWeightG: number
  zone: string | null
}

/**
 * Chargeable weight in grams for the charges API. Delhivery bills on the weight it measured;
 * our quoted weight is the fallback, and 500 g is the floor so a missing weight cannot send
 * cgm=0 (which the API rejects).
 */
export function chargeableGrams(chargedKg: unknown, quotedKg: unknown): number {
  const kg = Number(chargedKg) || Number(quotedKg) || 0
  return kg > 0 ? Math.round(kg * 1000) : 500
}

export interface InvoiceChargeQuery {
  awb: string
  /** Terminal state Delhivery bills on. The API rejects anything else. */
  settledStatus: 'Delivered' | 'RTO' | 'DTO'
  /** Chargeable weight in grams. */
  chargedWeightG: number
  originPin: string
  destPin: string
  /** S = Surface, E = Express. */
  mode?: 'S' | 'E'
  paymentType?: 'Pre-paid' | 'COD'
}

/**
 * Actual charges Delhivery billed for a shipment.
 *
 * The endpoint has five mandatory query params. The previous version sent only `waybill`, so
 * every call came back 400 ("md is mandatory field...") and the `!res.ok → null` guard turned
 * that into a silent "no charges yet" — the sync looked healthy and never once worked.
 *
 * Field names were wrong too: the response has no freight/cod/oda keys. Freight is `charge_DL`
 * and COD is `charge_COD`, so even a successful call would have stored zeros.
 *
 * Charges exist only once a shipment reaches a billed terminal state (Delivered / RTO / DTO) —
 * `ss` accepts nothing else — so there is nothing to fetch at "shipped".
 *
 * Still resolves to null rather than throwing (the caller treats charges as optional), but now
 * logs why, because a silent null is what hid this.
 */
export async function fetchDelhiveryInvoiceCharges(
  q: InvoiceChargeQuery
): Promise<DelhiveryInvoiceCharges | null> {
  const token = process.env.DELHIVERY_API_KEY
  if (!token) return null

  if (!q.originPin || !q.destPin || !q.chargedWeightG) {
    console.warn('[delhivery] invoice charges skipped — missing params', {
      awb: q.awb, originPin: q.originPin, destPin: q.destPin, chargedWeightG: q.chargedWeightG,
    })
    return null
  }

  const params = new URLSearchParams({
    waybill: q.awb,
    md: q.mode ?? 'S',
    ss: q.settledStatus,
    cgm: String(Math.max(1, Math.round(q.chargedWeightG))),
    o_pin: q.originPin,
    d_pin: q.destPin,
    ...(q.paymentType ? { pt: q.paymentType } : {}),
  })

  try {
    const res = await fetch(
      `https://track.delhivery.com/api/kinko/v1/invoice/charges/.json?${params}`,
      {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      }
    )

    const body = await res.text()
    if (!res.ok) {
      console.warn(`[delhivery] invoice charges ${res.status} for ${q.awb}: ${body.slice(0, 200)}`)
      return null
    }

    let data: unknown
    try { data = JSON.parse(body) } catch {
      console.warn(`[delhivery] invoice charges non-JSON for ${q.awb}: ${body.slice(0, 200)}`)
      return null
    }

    const record = (Array.isArray(data) ? data[0] : data) as Record<string, any> | undefined
    if (!record || typeof record !== 'object') return null
    if (record.error) {
      console.warn(`[delhivery] invoice charges error for ${q.awb}: ${String(record.error).slice(0, 200)}`)
      return null
    }

    const num = (...vals: unknown[]): number => {
      for (const v of vals) {
        if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v)
      }
      return 0
    }

    const tax = record.tax_data && typeof record.tax_data === 'object'
      ? Object.values(record.tax_data as Record<string, unknown>).reduce<number>((s, v) => s + num(v), 0)
      : 0

    return {
      total: num(record.total_amount),
      gross: num(record.gross_amount),
      // charge_DL is the delivery/freight leg; RTO and DTO shipments bill on their own legs.
      freight: num(record.charge_DL, record.charge_RTO, record.charge_DTO),
      codCharge: num(record.charge_COD, record.charge_CCOD),
      oda: num(record.charge_ODA, record.charge_ODA),
      tax,
      chargedWeightG: num(record.charged_weight),
      zone: typeof record.zone === 'string' ? record.zone : null,
    }
  } catch (err) {
    console.warn(`[delhivery] invoice charges failed for ${q.awb}:`, err)
    return null
  }
}
