import { envGstApiCreds, resolveGstApiCreds, type GstApiCreds } from './gst-api-creds'

export interface EInvoiceItem {
  slNo: string
  productDesc: string
  isService: 'Y' | 'N'
  hsnCode: string
  qty: number
  unit: string
  unitPrice: number
  totalAmount: number
  assAmt: number
  gstRate: number
  igstAmt: number
  cgstAmt: number
  sgstAmt: number
  totalItemVal: number
}

export interface EInvoicePayload {
  invoiceNumber: string
  invoiceDate: string
  supplyType: 'B2B' | 'B2C'
  sellerGstin: string
  sellerLegalName: string
  sellerAddress1: string
  sellerCity: string
  sellerStateCode: string
  sellerPincode: number
  buyerGstin: string
  buyerLegalName: string
  buyerAddress1: string
  buyerCity: string
  buyerStateCode: string
  buyerPincode: number
  buyerPos: string
  items: EInvoiceItem[]
  assVal: number
  cgstVal: number
  sgstVal: number
  igstVal: number
  totalInvVal: number
}

export interface IRNResult {
  irn: string
  ackNo: string
  ackDt: string
  signedQRCode: string
  status: 'generated' | 'stub'
}

// Per store and account, so one store's token is never used for another.
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export function __resetTokenCacheForTests(): void {
  tokenCache.clear()
}

/** Fetch a fresh IRP auth token with these credentials (also the connection test). */
export async function authenticateEInvoice(creds: GstApiCreds): Promise<string> {
  const res = await fetch(`${creds.baseUrl}/eivital/v1.04/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      gstin: creds.gstin,
    },
    body: JSON.stringify({
      UserName: creds.username,
      Password: creds.password,
      AppKey: creds.clientSecret,
      ForceRefreshAccessToken: true,
    }),
  })

  const data = await res.json()
  if (!res.ok || !data?.Data?.AuthToken) {
    throw new Error(`IRP auth failed: ${data?.message || res.statusText}`)
  }
  return String(data.Data.AuthToken)
}

async function getAuthToken(creds: GstApiCreds): Promise<string> {
  const cached = tokenCache.get(creds.cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const token = await authenticateEInvoice(creds)
  tokenCache.set(creds.cacheKey, { token, expiresAt: Date.now() + 6 * 60 * 60 * 1000 })
  return token
}

function irpHeaders(creds: GstApiCreds, token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    gstin: creds.gstin,
    user_name: creds.username,
    AuthToken: token,
  }
}

function buildIRPPayload(p: EInvoicePayload): object {
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: p.supplyType, RegRev: 'N', EcmGstin: null, IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: p.invoiceNumber, Dt: p.invoiceDate },
    SellerDtls: {
      Gstin: p.sellerGstin,
      LglNm: p.sellerLegalName,
      TrdNm: p.sellerLegalName,
      Addr1: p.sellerAddress1,
      Loc: p.sellerCity,
      Pin: p.sellerPincode,
      Stcd: p.sellerStateCode,
    },
    BuyerDtls: {
      Gstin: p.buyerGstin || 'URP',
      LglNm: p.buyerLegalName,
      TrdNm: p.buyerLegalName,
      Pos: p.buyerPos,
      Addr1: p.buyerAddress1,
      Loc: p.buyerCity,
      Pin: p.buyerPincode,
      Stcd: p.buyerStateCode,
    },
    ItemList: p.items.map(item => ({
      SlNo: item.slNo,
      PrdDesc: item.productDesc,
      IsServc: item.isService,
      HsnCd: item.hsnCode,
      Qty: item.qty,
      Unit: item.unit,
      UnitPrice: item.unitPrice,
      TotAmt: item.totalAmount,
      Discount: 0,
      AssAmt: item.assAmt,
      GstRt: item.gstRate,
      IgstAmt: item.igstAmt,
      CgstAmt: item.cgstAmt,
      SgstAmt: item.sgstAmt,
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: item.totalItemVal,
    })),
    ValDtls: {
      AssVal: p.assVal,
      CgstVal: p.cgstVal,
      SgstVal: p.sgstVal,
      IgstVal: p.igstVal,
      CesVal: 0,
      StCesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: p.totalInvVal,
    },
  }
}

/** Generate with the store's own credentials (the flagship: the platform env, else a stub). A store
 * without its own credentials gets GstApiNotConnectedError. */
export async function generateIRN(payload: EInvoicePayload): Promise<IRNResult> {
  const creds = await resolveGstApiCreds('einvoice')
  if (!creds) {
    return {
      irn: `STUB-${payload.invoiceNumber}-${Date.now()}`,
      ackNo: `STUB-ACK-${Date.now()}`,
      ackDt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      signedQRCode: '',
      status: 'stub',
    }
  }

  const token = await getAuthToken(creds)

  const res = await fetch(`${creds.baseUrl}/eicore/v1.03/Invoice`, {
    method: 'POST',
    headers: irpHeaders(creds, token),
    body: JSON.stringify(buildIRPPayload(payload)),
  })

  const data = await res.json()
  if (!res.ok || !data?.Data) {
    throw new Error(`IRN generation failed: ${data?.message || JSON.stringify(data?.error || data)}`)
  }

  return {
    irn: data.Data.Irn,
    ackNo: data.Data.AckNo,
    ackDt: data.Data.AckDt,
    signedQRCode: data.Data.SignedQRCode,
    status: 'generated',
  }
}

export async function cancelIRN(irn: string, cancelReason: 1 | 2 | 3 | 4, cancelRemark: string): Promise<void> {
  const creds = await resolveGstApiCreds('einvoice')
  if (!creds) throw new Error('e-Invoice credentials not configured')

  const token = await getAuthToken(creds)

  const res = await fetch(`${creds.baseUrl}/eicore/v1.03/Invoice/Cancel`, {
    method: 'POST',
    headers: irpHeaders(creds, token),
    body: JSON.stringify({ Irn: irn, CnlRsn: cancelReason, CnlRem: cancelRemark }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`IRN cancellation failed: ${data?.message || res.statusText}`)
}

/** Whether the platform env credentials (the flagship's) are set. */
export function isEInvoiceConfigured(): boolean {
  return !!envGstApiCreds('einvoice')
}
