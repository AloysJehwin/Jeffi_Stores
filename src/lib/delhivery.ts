import { query } from '@/lib/db'

const DELHIVERY_EDIT_URL = 'https://track.delhivery.com/api/p/edit'
const DELHIVERY_CREATE_URL = 'https://track.delhivery.com/api/cmu/create.json'

const ORIGIN_PIN = process.env.DELHIVERY_ORIGIN_PINCODE || '492001'
const PICKUP_LOCATION = process.env.DELHIVERY_PICKUP_LOCATION || 'Jeffi Stores'
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

  const {
    consigneeName, address, pin, city, state, phone,
    invoiceRef, totalAmount, orderDate, weightKg, productDesc, quantity,
  } = params

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
      payment_mode: 'Prepaid',
      order_type: 'reverse',
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

  const {
    consigneeName, address, pin, city, state, phone,
    invoiceRef, totalAmount, orderDate, weightKg, productDesc, quantity,
  } = params

  const customQc = [{
    description: productDesc,
    images: [],
    quantity: 1,
    questions: QC_QUESTIONS.map(q => ({
      questions_id: q.questions_id,
      options: q.type === 'multi' ? q.options.map(o => ({ value: [o] })) : [],
      required: q.required,
      type: q.type,
    })),
  }]

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
      payment_mode: 'Prepaid',
      order_type: 'reverse',
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
      qc_type: 'param',
      custom_qc: customQc,
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
