import crypto from 'crypto'

/**
 * PhonePe PG v2 (Standard Checkout) client: OAuth token per client id, create / status / refund, and
 * the webhook Authorization check. docs/plans/UPI_AND_MESSAGING_ADDON.md §1.1 is the contract.
 */

export type PhonePeEnv = 'sandbox' | 'production'

export interface PhonePeClientCreds {
  env: PhonePeEnv
  clientId: string
  clientSecret: string
  clientVersion: string
}

/** OAuth host per environment (also used by the integrations card's connection test). */
export const PHONEPE_AUTH_BASE = {
  sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  production: 'https://api.phonepe.com/apis/identity-manager',
} as const
export const PHONEPE_API_BASE = {
  sandbox: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  production: 'https://api.phonepe.com/apis/pg',
} as const

export const PHONEPE_PAYMENT_MODES = ['UPI_INTENT', 'UPI_QR', 'UPI_COLLECT'] as const
/** Seconds a hosted checkout stays payable (PhonePe allows 300–3600). */
export const PHONEPE_EXPIRE_AFTER_SEC = 1200

export class PhonePeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'PhonePeError'
  }
}

export const phonePeEnv = (v: unknown): PhonePeEnv => (v === 'production' ? 'production' : 'sandbox')

const tokenCache = new Map<string, { token: string; expiresAt: number }>()
const cacheKey = (c: PhonePeClientCreds) => `${c.env}|${c.clientId}`

export function clearPhonePeTokenCache() {
  tokenCache.clear()
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

function fail(res: Response, data: any, what: string): never {
  const code = data?.code ?? data?.errorCode ?? undefined
  const message = data?.message ?? data?.error_description ?? data?.error ?? `${what} failed (${res.status})`
  throw new PhonePeError(`PhonePe ${what}: ${message}`, res.status, code ? String(code) : undefined, data)
}

/** O-Bearer access token, cached until a minute before PhonePe's expires_at. */
export async function accessToken(creds: PhonePeClientCreds): Promise<string> {
  const key = cacheKey(creds)
  const hit = tokenCache.get(key)
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.token
  const res = await fetch(`${PHONEPE_AUTH_BASE[creds.env]}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_version: creds.clientVersion,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
    }),
  })
  const data = await readJson(res)
  if (!res.ok || !data?.access_token) fail(res, data, 'token')
  // expires_at is epoch seconds; fall back to an hour when absent.
  const expiresAt = Number(data.expires_at) > 0 ? Number(data.expires_at) * 1000 : Date.now() + 3600_000
  tokenCache.set(key, { token: String(data.access_token), expiresAt })
  return String(data.access_token)
}

async function call<T = any>(creds: PhonePeClientCreds, method: 'GET' | 'POST', path: string, body?: unknown, what = path): Promise<T> {
  const token = await accessToken(creds)
  const res = await fetch(`${PHONEPE_API_BASE[creds.env]}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await readJson(res)
  if (res.status === 401) tokenCache.delete(cacheKey(creds))
  if (!res.ok) fail(res, data, what)
  return data as T
}

export interface CreatePaymentInput {
  merchantOrderId: string
  amountPaise: number
  redirectUrl: string
  message?: string
  metaInfo?: Partial<Record<'udf1' | 'udf2' | 'udf3' | 'udf4' | 'udf5', string>>
  expireAfter?: number
}

export interface CreatePaymentResult {
  orderId: string
  state: string
  expireAt?: number
  redirectUrl: string
}

/** Opens a hosted checkout limited to UPI (intent / QR / collect). */
export async function createPayment(creds: PhonePeClientCreds, input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const data = await call<CreatePaymentResult>(
    creds,
    'POST',
    '/checkout/v2/pay',
    {
      merchantOrderId: input.merchantOrderId,
      amount: Math.round(input.amountPaise),
      expireAfter: input.expireAfter ?? PHONEPE_EXPIRE_AFTER_SEC,
      metaInfo: input.metaInfo ?? {},
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: input.message ?? 'Payment',
        merchantUrls: { redirectUrl: input.redirectUrl },
        paymentModeConfig: { enabledPaymentModes: PHONEPE_PAYMENT_MODES.map(type => ({ type })) },
      },
    },
    'create payment'
  )
  if (!data?.redirectUrl) throw new PhonePeError('PhonePe create payment: no redirectUrl returned', 502, undefined, data)
  return data
}

export type PhonePeState = 'PENDING' | 'COMPLETED' | 'FAILED'

export interface PhonePePaymentDetail {
  transactionId: string
  paymentMode?: string
  state?: string
  amount?: number
  timestamp?: number
  rail?: { type?: string; utr?: string; upiTransactionId?: string; vpa?: string }
  errorCode?: string
  detailedErrorCode?: string
}

export interface PhonePeOrderStatus {
  orderId: string
  state: PhonePeState
  amount: number
  expireAt?: number
  paymentDetails: PhonePePaymentDetail[]
  errorCode?: string
  errorContext?: unknown
}

/** The order as PhonePe holds it: the only state we settle from. */
export async function orderStatus(creds: PhonePeClientCreds, merchantOrderId: string): Promise<PhonePeOrderStatus> {
  const data = await call<any>(creds, 'GET', `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false&errorContext=true`, undefined, 'order status')
  return parseOrderStatus(data)
}

export function parseOrderStatus(data: any): PhonePeOrderStatus {
  const state = String(data?.state ?? 'PENDING').toUpperCase()
  return {
    orderId: String(data?.orderId ?? ''),
    state: state === 'COMPLETED' || state === 'FAILED' ? state : 'PENDING',
    amount: Number(data?.amount) || 0,
    expireAt: Number(data?.expireAt) > 0 ? Number(data.expireAt) : undefined,
    paymentDetails: Array.isArray(data?.paymentDetails) ? data.paymentDetails : [],
    errorCode: data?.errorCode ? String(data.errorCode) : undefined,
    errorContext: data?.errorContext,
  }
}

/** The attempt that completed, or the latest one, with its UPI rail details. */
export function completedPayment(status: PhonePeOrderStatus): PhonePePaymentDetail | null {
  const done = status.paymentDetails.find(p => String(p.state).toUpperCase() === 'COMPLETED')
  return done ?? status.paymentDetails[status.paymentDetails.length - 1] ?? null
}

export interface RefundResult {
  refundId: string
  state: string
  amount: number
}

export async function refund(creds: PhonePeClientCreds, input: { merchantRefundId: string; originalMerchantOrderId: string; amountPaise: number }): Promise<RefundResult> {
  const data = await call<any>(
    creds,
    'POST',
    '/payments/v2/refund',
    { merchantRefundId: input.merchantRefundId, originalMerchantOrderId: input.originalMerchantOrderId, amount: Math.round(input.amountPaise) },
    'refund'
  )
  return { refundId: String(data?.refundId ?? ''), state: String(data?.state ?? 'PENDING').toUpperCase(), amount: Number(data?.amount) || input.amountPaise }
}

export async function refundStatus(creds: PhonePeClientCreds, merchantRefundId: string): Promise<RefundResult & { errorCode?: string }> {
  const data = await call<any>(creds, 'GET', `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`, undefined, 'refund status')
  return {
    refundId: String(data?.refundId ?? ''),
    state: String(data?.state ?? 'PENDING').toUpperCase(),
    amount: Number(data?.amount) || 0,
    errorCode: data?.errorCode ? String(data.errorCode) : undefined,
  }
}

/** What PhonePe sends in the webhook Authorization header for these dashboard credentials. */
export const callbackAuthHash = (username: string, password: string) => crypto.createHash('sha256').update(`${username}:${password}`).digest('hex')

/** Constant-time check of the webhook header (hex, either case, optional "SHA256 " prefix). */
export function verifyCallbackAuth(authHeader: string | null | undefined, username: string, password: string): boolean {
  if (!authHeader || !username || !password) return false
  const given = authHeader.trim().replace(/^sha256\s+/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(given)) return false
  const a = Buffer.from(given, 'hex')
  const b = Buffer.from(callbackAuthHash(username, password), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
