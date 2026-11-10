import { PHONEPE_API_BASE, PhonePeError, accessToken, clearPhonePeTokenCache, type PhonePeClientCreds } from './phonepe'
import { resolveUpiProvider, upiAvailable } from './creds'

/**
 * PhonePe Autopay (PG v2, Standard Checkout flavour): mandate setup on the hosted page, then for each
 * renewal a pre-debit notification and, 24 h later, the debit. docs/PAYMENTS_UPI.md, "PhonePe Autopay".
 * PhonePe has no merchant pause API: pausing is the customer's, in their UPI app.
 */

export type AutopayFrequency = 'DAILY' | 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'HALFYEARLY' | 'YEARLY' | 'ON_DEMAND'

/** NPCI cap for a mandate debited without a UPI PIN each time. */
export const AUTOPAY_MAX_AMOUNT_PAISE = 1_500_000

async function call<T = any>(creds: PhonePeClientCreds, method: 'GET' | 'POST', path: string, body: unknown, what: string): Promise<T> {
  const token = await accessToken(creds)
  const res = await fetch(`${PHONEPE_API_BASE[creds.env]}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `O-Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (res.status === 401) clearPhonePeTokenCache()
  if (!res.ok) {
    const code = data?.code ?? data?.errorCode
    throw new PhonePeError(`PhonePe ${what}: ${data?.message ?? data?.error ?? `failed (${res.status})`}`, res.status, code ? String(code) : undefined, data)
  }
  return data as T
}

const enc = encodeURIComponent
const epoch = (v: unknown): Date | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n) : null
}

export interface SetupMandateInput {
  merchantOrderId: string
  merchantSubscriptionId: string
  /** Debited now (the first cycle). */
  amountPaise: number
  maxAmountPaise: number
  frequency: AutopayFrequency
  /** When the mandate ends. */
  expireAt: Date
  redirectUrl: string
  /** Seconds the hosted page stays open (300–3600). */
  expireAfter?: number
  metaInfo?: Partial<Record<'udf1' | 'udf2' | 'udf3' | 'udf4' | 'udf5', string>>
}

export interface SetupMandateResult {
  orderId: string
  state: string
  redirectUrl: string
}

/** Opens the hosted mandate page; the customer approves the mandate and pays the first cycle there. */
export async function setupMandate(creds: PhonePeClientCreds, input: SetupMandateInput): Promise<SetupMandateResult> {
  const data = await call<any>(
    creds,
    'POST',
    '/checkout/v2/pay',
    {
      merchantOrderId: input.merchantOrderId,
      amount: Math.round(input.amountPaise),
      expireAfter: input.expireAfter ?? 1200,
      metaInfo: input.metaInfo ?? {},
      paymentFlow: {
        type: 'SUBSCRIPTION_CHECKOUT_SETUP',
        merchantUrls: { redirectUrl: input.redirectUrl },
        subscriptionDetails: {
          subscriptionType: 'RECURRING',
          merchantSubscriptionId: input.merchantSubscriptionId,
          authWorkflowType: 'TRANSACTION',
          amountType: 'FIXED',
          maxAmount: Math.min(AUTOPAY_MAX_AMOUNT_PAISE, Math.round(input.maxAmountPaise)),
          frequency: input.frequency,
          expireAt: input.expireAt.getTime(),
        },
      },
    },
    'mandate setup'
  )
  if (!data?.redirectUrl) throw new PhonePeError('PhonePe mandate setup: no redirectUrl returned', 502, undefined, data)
  return { orderId: String(data.orderId ?? ''), state: String(data.state ?? 'PENDING').toUpperCase(), redirectUrl: String(data.redirectUrl) }
}

export interface AutopayPayment {
  transactionId: string
  state: string
  amountPaise: number
  utr?: string
  umn?: string
  errorCode?: string
  at?: Date | null
}

export interface AutopayOrderStatus {
  orderId: string
  /** Setup / redemption: PENDING | COMPLETED | FAILED. A notify order: NOTIFICATION_IN_PROGRESS | NOTIFIED first. */
  state: string
  amountPaise: number
  flowType?: string
  merchantSubscriptionId?: string
  /** PhonePe's id for the mandate (setup orders). */
  subscriptionId?: string
  /** Redemption window and notification time (notify / redemption orders). */
  validAfter?: Date | null
  validUpto?: Date | null
  notifiedAt?: Date | null
  expireAt?: Date | null
  errorCode?: string
  payments: AutopayPayment[]
}

export function parseAutopayOrder(data: any): AutopayOrderStatus {
  const flow = data?.paymentFlow ?? {}
  const payments: AutopayPayment[] = (Array.isArray(data?.paymentDetails) ? data.paymentDetails : []).map((p: any) => ({
    transactionId: String(p?.transactionId ?? ''),
    state: String(p?.state ?? '').toUpperCase(),
    amountPaise: Number(p?.amount) || 0,
    utr: p?.rail?.utr ? String(p.rail.utr) : undefined,
    umn: p?.rail?.umn ? String(p.rail.umn) : undefined,
    errorCode: p?.detailedErrorCode ? String(p.detailedErrorCode) : p?.errorCode ? String(p.errorCode) : undefined,
    at: epoch(p?.timestamp),
  }))
  return {
    orderId: String(data?.orderId ?? ''),
    state: String(data?.state ?? 'PENDING').toUpperCase(),
    amountPaise: Number(data?.amount) || 0,
    flowType: flow.type ? String(flow.type) : undefined,
    merchantSubscriptionId: flow.merchantSubscriptionId ? String(flow.merchantSubscriptionId) : undefined,
    subscriptionId: flow.subscriptionId ? String(flow.subscriptionId) : undefined,
    validAfter: epoch(flow.validAfter),
    validUpto: epoch(flow.validUpto),
    notifiedAt: epoch(flow.notifiedAt),
    expireAt: epoch(data?.expireAt),
    errorCode: data?.detailedErrorCode ? String(data.detailedErrorCode) : data?.errorCode ? String(data.errorCode) : undefined,
    payments,
  }
}

/** The attempt that completed, else the latest. */
export const completedAutopayPayment = (o: AutopayOrderStatus): AutopayPayment | null =>
  o.payments.find(p => p.state === 'COMPLETED') ?? o.payments[o.payments.length - 1] ?? null

/** Setup, notification and redemption orders all share the checkout order-status endpoint. */
export async function autopayOrderStatus(creds: PhonePeClientCreds, merchantOrderId: string): Promise<AutopayOrderStatus> {
  return parseAutopayOrder(await call(creds, 'GET', `/checkout/v2/order/${enc(merchantOrderId)}/status?details=true`, undefined, 'order status'))
}

export type MandateState =
  | 'ACTIVATION_IN_PROGRESS'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCEL_IN_PROGRESS'
  | 'CANCELLED'
  | 'REVOKE_IN_PROGRESS'
  | 'REVOKED'
  | 'PAUSE_IN_PROGRESS'
  | 'PAUSED'
  | 'UNPAUSE_IN_PROGRESS'

export interface MandateStatus {
  merchantSubscriptionId: string
  subscriptionId: string
  state: MandateState | string
  maxAmountPaise: number
  frequency?: string
  expireAt: Date | null
  pauseStartDate: Date | null
  pauseEndDate: Date | null
}

export function parseMandate(data: any): MandateStatus {
  return {
    merchantSubscriptionId: String(data?.merchantSubscriptionId ?? ''),
    subscriptionId: String(data?.subscriptionId ?? ''),
    state: String(data?.state ?? '').toUpperCase(),
    maxAmountPaise: Number(data?.maxAmount) || 0,
    frequency: data?.frequency ? String(data.frequency) : undefined,
    expireAt: epoch(data?.expireAt),
    pauseStartDate: epoch(data?.pauseStartDate),
    pauseEndDate: epoch(data?.pauseEndDate),
  }
}

export async function mandateStatus(creds: PhonePeClientCreds, merchantSubscriptionId: string): Promise<MandateStatus> {
  return parseMandate(await call(creds, 'GET', `/checkout/v2/subscriptions/${enc(merchantSubscriptionId)}/status`, undefined, 'subscription status'))
}

export interface NotifyRedemptionInput {
  merchantOrderId: string
  merchantSubscriptionId: string
  amountPaise: number
  /** When the order lapses if it never completes. */
  expireAt?: Date
}

/** Pre-debit notification for one renewal. autoDebit is off: we execute it ourselves on the due date. */
export async function notifyRedemption(creds: PhonePeClientCreds, input: NotifyRedemptionInput): Promise<{ orderId: string; state: string; expireAt: Date | null }> {
  const data = await call<any>(
    creds,
    'POST',
    '/checkout/v2/subscriptions/notify',
    {
      merchantOrderId: input.merchantOrderId,
      amount: Math.round(input.amountPaise),
      ...(input.expireAt ? { expireAt: input.expireAt.getTime() } : {}),
      paymentFlow: {
        type: 'SUBSCRIPTION_CHECKOUT_REDEMPTION',
        merchantSubscriptionId: input.merchantSubscriptionId,
        redemptionRetryStrategy: 'STANDARD',
        autoDebit: false,
      },
    },
    'notify redemption'
  )
  return { orderId: String(data?.orderId ?? ''), state: String(data?.state ?? 'NOTIFICATION_IN_PROGRESS').toUpperCase(), expireAt: epoch(data?.expireAt) }
}

/** Debits a notified redemption. PhonePe retries a failed attempt itself (STANDARD) within the order's window. */
export async function executeRedemption(creds: PhonePeClientCreds, merchantOrderId: string): Promise<{ transactionId: string; state: string }> {
  const data = await call<any>(creds, 'POST', '/checkout/v2/subscriptions/redeem', { merchantOrderId }, 'execute redemption')
  return { transactionId: String(data?.transactionId ?? ''), state: String(data?.state ?? 'PENDING').toUpperCase() }
}

/** Ends the mandate; no further debits are possible. 204 on success. */
export async function cancelMandate(creds: PhonePeClientCreds, merchantSubscriptionId: string): Promise<void> {
  await call(creds, 'POST', `/checkout/v2/subscriptions/${enc(merchantSubscriptionId)}/cancel`, undefined, 'subscription cancel')
}

export type AutopayCreds = PhonePeClientCreds & { merchantId?: string }

/**
 * The PhonePe account a store's subscriptions bill through, or null when its UPI provider is not PhonePe
 * (docs/plans/UPI_UPG_V2.md §1, §6). Kill switches are not applied: existing mandates keep renewing.
 */
export async function autopayCreds(tenantId: string | null | undefined): Promise<AutopayCreds | null> {
  const choice = await resolveUpiProvider(tenantId ?? null)
  return choice.provider === 'phonepe' ? choice.creds : null
}

/** New sign-ups: UPI is on for the store and its provider is PhonePe. */
export async function autopaySignupCreds(tenantId: string | null | undefined): Promise<AutopayCreds | null> {
  if (!(await upiAvailable(tenantId ?? null).catch(() => false))) return null
  return autopayCreds(tenantId)
}
