import { query } from '@/lib/db'
import { getBusinessValues } from '@/lib/site-controls'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'
const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'
const SELLER_NAME = process.env.DELHIVERY_SELLER_NAME || 'Jeffi Stores'
const SELLER_ADD = process.env.DELHIVERY_SELLER_ADDRESS || 'Near Arihant Complex, Sanjay Gandhi Chowk, Station Road, Raipur'
const SELLER_PHONE = process.env.DELHIVERY_SELLER_PHONE || '07713585374'

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
}

// Pulls the actual billed charges Delhivery raised for a shipment once it's
// invoiced. Non-fatal by design: the invoice may not be ready right after
// delivery, so any failure resolves to null rather than throwing.
export async function fetchDelhiveryInvoiceCharges(
  awb: string
): Promise<DelhiveryInvoiceCharges | null> {
  const token = process.env.DELHIVERY_API_KEY
  if (!token) return null

  try {
    const res = await fetch(
      `https://track.delhivery.com/api/kinko/v1/invoice/charges/.json?waybill=${encodeURIComponent(awb)}`,
      {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      }
    )

    if (!res.ok) return null

    const data = await res.json()
    // Response shape varies across accounts — payload may be a bare object or
    // wrapped in an array, and field names differ, so probe several aliases.
    const record = Array.isArray(data) ? data[0] : data
    if (!record || typeof record !== 'object') return null

    const num = (...vals: unknown[]): number => {
      for (const v of vals) {
        if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v)
      }
      return 0
    }

    return {
      total: num(record.total_amount, record.total, record.charged_amount),
      freight: num(record.freight_charge, record.frt_charge, record.freight),
      codCharge: num(record.cod_charges, record.cod_charge, record.cod),
      oda: num(record.oda_charge, record.oda_charges, record.oda),
    }
  } catch {
    return null
  }
}
