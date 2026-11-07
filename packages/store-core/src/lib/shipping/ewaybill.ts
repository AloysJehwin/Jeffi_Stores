import { envGstApiCreds, resolveGstApiCreds, type GstApiCreds } from './gst-api-creds'

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

// Per store and account, so one store's token is never used for another.
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

/** Fetch a fresh auth token with these credentials (also the connection test). */
export async function authenticateEWayBill(creds: GstApiCreds): Promise<string> {
  const res = await fetch(`${creds.baseUrl}/ewayapi/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      clientid: creds.clientId,
      clientsecret: creds.clientSecret,
      gstin: creds.gstin,
    },
    body: JSON.stringify({
      action: 'ACCESSTOKEN',
      username: creds.username,
      password: creds.password,
      appkey: creds.clientSecret,
    }),
  })

  const data = await res.json()
  if (!res.ok || !data?.response?.authtoken) {
    throw new Error(`EWB auth failed: ${data?.message || res.statusText}`)
  }
  return String(data.response.authtoken)
}

async function getAuthToken(creds: GstApiCreds): Promise<string> {
  const cached = tokenCache.get(creds.cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const token = await authenticateEWayBill(creds)
  tokenCache.set(creds.cacheKey, { token, expiresAt: Date.now() + 6 * 60 * 60 * 1000 })
  return token
}

/** Generate with the store's own credentials (the flagship: the platform env, else a stub). A store
 * without its own credentials gets GstApiNotConnectedError. */
export async function generateEWayBill(payload: EWayBillPayload): Promise<EWayBillResult> {
  const creds = await resolveGstApiCreds('ewaybill')
  if (!creds) {
    return {
      ewbNo: `STUB-EWB-${Date.now()}`,
      ewbDt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      ewbValidTill: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      status: 'stub',
    }
  }

  const token = await getAuthToken(creds)

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

  const res = await fetch(`${creds.baseUrl}/ewayapi/ewayapi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      clientid: creds.clientId,
      clientsecret: creds.clientSecret,
      gstin: creds.gstin,
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

/** Whether the platform env credentials (the flagship's) are set. */
export function isEWayBillConfigured(): boolean {
  return !!envGstApiCreds('ewaybill')
}
