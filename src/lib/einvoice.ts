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

let cachedToken: { token: string; expiresAt: number } | null = null

function isConfigured(): boolean {
  return !!(
    process.env.EINVOICE_CLIENT_ID &&
    process.env.EINVOICE_CLIENT_SECRET &&
    process.env.EINVOICE_USERNAME &&
    process.env.EINVOICE_PASSWORD &&
    process.env.EINVOICE_GSTIN
  )
}

function baseUrl(): string {
  return process.env.EINVOICE_BASE_URL || 'https://einvoice1-sandbox.nic.in'
}

async function getAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const res = await fetch(`${baseUrl()}/eivital/v1.04/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: process.env.EINVOICE_CLIENT_ID!,
      client_secret: process.env.EINVOICE_CLIENT_SECRET!,
      gstin: process.env.EINVOICE_GSTIN!,
    },
    body: JSON.stringify({
      UserName: process.env.EINVOICE_USERNAME,
      Password: process.env.EINVOICE_PASSWORD,
      AppKey: process.env.EINVOICE_CLIENT_SECRET,
      ForceRefreshAccessToken: true,
    }),
  })

  const data = await res.json()
  if (!res.ok || !data?.Data?.AuthToken) {
    throw new Error(`IRP auth failed: ${data?.message || res.statusText}`)
  }

  cachedToken = { token: data.Data.AuthToken, expiresAt: Date.now() + 6 * 60 * 60 * 1000 }
  return cachedToken.token
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
      CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0,
      StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: item.totalItemVal,
    })),
    ValDtls: {
      AssVal: p.assVal,
      CgstVal: p.cgstVal,
      SgstVal: p.sgstVal,
      IgstVal: p.igstVal,
      CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0,
      TotInvVal: p.totalInvVal,
    },
  }
}

export async function generateIRN(payload: EInvoicePayload): Promise<IRNResult> {
  if (!isConfigured()) {
    return {
      irn: `STUB-${payload.invoiceNumber}-${Date.now()}`,
      ackNo: `STUB-ACK-${Date.now()}`,
      ackDt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      signedQRCode: '',
      status: 'stub',
    }
  }

  const token = await getAuthToken()

  const res = await fetch(`${baseUrl()}/eicore/v1.03/Invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: process.env.EINVOICE_CLIENT_ID!,
      client_secret: process.env.EINVOICE_CLIENT_SECRET!,
      gstin: process.env.EINVOICE_GSTIN!,
      user_name: process.env.EINVOICE_USERNAME!,
      AuthToken: token,
    },
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
  if (!isConfigured()) throw new Error('e-Invoice credentials not configured')

  const token = await getAuthToken()

  const res = await fetch(`${baseUrl()}/eicore/v1.03/Invoice/Cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      client_id: process.env.EINVOICE_CLIENT_ID!,
      client_secret: process.env.EINVOICE_CLIENT_SECRET!,
      gstin: process.env.EINVOICE_GSTIN!,
      user_name: process.env.EINVOICE_USERNAME!,
      AuthToken: token,
    },
    body: JSON.stringify({ Irn: irn, CnlRsn: cancelReason, CnlRem: cancelRemark }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(`IRN cancellation failed: ${data?.message || res.statusText}`)
}

export function isEInvoiceConfigured(): boolean {
  return isConfigured()
}
