export interface EWayBillPayload {
  supplyType: 'O' | 'I'
  subSupplyType: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12'
  docType: 'INV' | 'BIL' | 'BOE' | 'CNT' | 'CHL' | 'OTH'
  docNo: string
  docDate: string
  fromGstin: string
  fromTrdName: string
  fromAddr1: string
  fromPlace: string
  fromPincode: number
  fromStateCode: number
  toGstin: string
  toTrdName: string
  toAddr1: string
  toPlace: string
  toPincode: number
  toStateCode: number
  totalValue: number
  cgstValue: number
  sgstValue: number
  igstValue: number
  cessValue: number
  transporterName?: string
  transporterId?: string
  transMode: '1' | '2' | '3' | '4'
  transDistance: number
  vehicleNo?: string
  vehicleType?: 'R' | 'O'
  items: Array<{
    productName: string
    productDesc: string
    hsnCode: string
    quantity: number
    qtyUnit: string
    taxableAmount: number
    sgstRate: number
    cgstRate: number
    igstRate: number
    cessRate: number
  }>
}

export interface EWayBillResult {
  ewbNo: string
  ewbDt: string
  ewbValidTill: string
  status: 'generated' | 'stub'
}

let cachedToken: { token: string; expiresAt: number } | null = null

function isConfigured(): boolean {
  return !!(
    process.env.EWAYBILL_CLIENT_ID &&
    process.env.EWAYBILL_CLIENT_SECRET &&
    process.env.EWAYBILL_USERNAME &&
    process.env.EWAYBILL_PASSWORD &&
    process.env.EWAYBILL_GSTIN
  )
}

function baseUrl(): string {
  return process.env.EWAYBILL_BASE_URL || 'https://gst.gov.in/api'
}

async function getAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const res = await fetch(`${baseUrl()}/ewayapi/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      clientid: process.env.EWAYBILL_CLIENT_ID!,
      clientsecret: process.env.EWAYBILL_CLIENT_SECRET!,
      gstin: process.env.EWAYBILL_GSTIN!,
    },
    body: JSON.stringify({
      action: 'ACCESSTOKEN',
      username: process.env.EWAYBILL_USERNAME,
      password: process.env.EWAYBILL_PASSWORD,
      appkey: process.env.EWAYBILL_CLIENT_SECRET,
    }),
  })

  const data = await res.json()
  if (!res.ok || !data?.response?.authtoken) {
    throw new Error(`EWB auth failed: ${data?.message || res.statusText}`)
  }

  cachedToken = { token: data.response.authtoken, expiresAt: Date.now() + 6 * 60 * 60 * 1000 }
  return cachedToken.token
}

export async function generateEWayBill(payload: EWayBillPayload): Promise<EWayBillResult> {
  if (!isConfigured()) {
    return {
      ewbNo: `STUB-EWB-${Date.now()}`,
      ewbDt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ewbValidTill: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      status: 'stub',
    }
  }

  const token = await getAuthToken()

  const body = {
    action: 'GENEWAYBILL',
    data: {
      supplyType: payload.supplyType,
      subSupplyType: payload.subSupplyType,
      docType: payload.docType,
      docNo: payload.docNo,
      docDate: payload.docDate,
      fromGstin: payload.fromGstin,
      fromTrdName: payload.fromTrdName,
      fromAddr1: payload.fromAddr1,
      fromPlace: payload.fromPlace,
      fromPincode: payload.fromPincode,
      fromStateCode: payload.fromStateCode,
      toGstin: payload.toGstin,
      toTrdName: payload.toTrdName,
      toAddr1: payload.toAddr1,
      toPlace: payload.toPlace,
      toPincode: payload.toPincode,
      toStateCode: payload.toStateCode,
      transactionType: 1,
      otherValue: 0,
      totalValue: payload.totalValue,
      cgstValue: payload.cgstValue,
      sgstValue: payload.sgstValue,
      igstValue: payload.igstValue,
      cessValue: payload.cessValue,
      cessNonAdvolValue: 0,
      transporterName: payload.transporterName || '',
      transporterId: payload.transporterId || '',
      transMode: payload.transMode,
      transDistance: payload.transDistance,
      vehicleNo: payload.vehicleNo || '',
      vehicleType: payload.vehicleType || 'R',
      itemList: payload.items.map(item => ({
        productName: item.productName,
        productDesc: item.productDesc,
        hsnCode: item.hsnCode,
        quantity: item.quantity,
        qtyUnit: item.qtyUnit,
        taxableAmount: item.taxableAmount,
        sgstRate: item.sgstRate,
        cgstRate: item.cgstRate,
        igstRate: item.igstRate,
        cessRate: item.cessRate,
        cessNonadvlAmt: 0,
      })),
    },
  }

  const res = await fetch(`${baseUrl()}/ewayapi/ewayapi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      clientid: process.env.EWAYBILL_CLIENT_ID!,
      clientsecret: process.env.EWAYBILL_CLIENT_SECRET!,
      gstin: process.env.EWAYBILL_GSTIN!,
      authtoken: token,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok || !data?.response?.ewbNo) {
    throw new Error(`E-way bill generation failed: ${data?.message || JSON.stringify(data?.error || data)}`)
  }

  return {
    ewbNo: String(data.response.ewbNo),
    ewbDt: data.response.ewbDt,
    ewbValidTill: data.response.ewbValidTill,
    status: 'generated',
  }
}

export function isEWayBillConfigured(): boolean {
  return isConfigured()
}
