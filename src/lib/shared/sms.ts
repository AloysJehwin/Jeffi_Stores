import { logMessage } from '@/lib/shared/message-log'
import { messagingInline, remoteSend } from '@/lib/shared/messaging/remote'
import { storeBaseUrlAsync, storeSignature } from '@/lib/catalog/brand'
import { orderUrlByNumber } from '@/lib/shared/customer-links'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getSmsProvider } from '@/lib/shared/messaging'
import { messagingGateAllows } from '@/lib/shared/messaging/billing'
import { sendByTemplate } from '@/lib/shared/send-by-template'

// SMS send path. The provider (Twilio today, AWS later) is chosen per-tenant by the Site Controls
// selector in src/lib/shared/messaging; this file owns the shared concerns: phone normalization,
// the channel-enabled gate, and audit logging.
//
// SMS can be turned off two ways: the Site Controls "SMS" toggle (per-tenant, feature_sms_enabled)
// or the env SMS_DISABLED kill-switch. The env value is the DEFAULT the Site Controls flag falls
// back to, so checking the flag honors both.

// Is SMS enabled for the current tenant? Honors the Site Controls toggle (feature_sms_enabled),
// which itself defaults to `SMS_DISABLED !== 'true'`. getFeatureFlags never throws, but the catch
// keeps this self-contained so a resolver hiccup can't harden into a silent outage.
async function smsChannelEnabled(): Promise<boolean> {
  try {
    return (await getFeatureFlags()).smsEnabled
  } catch {
    return process.env.SMS_DISABLED !== 'true'
  }
}

// Normalize Indian mobile numbers to E.164 format (+91XXXXXXXXXX).
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `+91${digits.slice(3)}`
  if (phone.trim().startsWith('+')) return phone.trim()
  return null
}

// `kind` labels the message for the audit log. 'otp' is never persisted.
async function sendSMS(to: string | null | undefined, body: string, kind: string): Promise<boolean> {
  const normalized = normalizePhone(to)
  if (!normalized) return false
  if (!(await smsChannelEnabled())) return false
  if (!(await messagingGateAllows('sms', false))) return false
  if (!messagingInline()) {
    const r = await remoteSend({ channel: 'sms', to: normalized, body, metadata: { kind } })
    logMessage({ channel: 'sms', to: normalized, from: 'messaging-service', body, kind, status: r.ok ? 'sent' : 'failed', providerSid: r.providerRef, provider: 'messaging-service', error: r.error, deliveryStatus: r.ok ? 'estimated' : undefined })
    return r.ok
  }
  const provider = await getSmsProvider()
  if (!provider.configured) return false
  try {
    const sid = await provider.sendText(normalized, body)
    const { debitMessageEstimate } = await import('@/lib/shared/messaging/billing')
    const { estimateFor } = await import('@/lib/shared/messaging/pricing')
    debitMessageEstimate({ channel: 'sms', providerSid: sid }).catch(() => {})
    logMessage({
      channel: 'sms',
      to: normalized,
      from: provider.from,
      body,
      kind,
      status: 'sent',
      providerSid: sid,
      provider: provider.name,
      price: estimateFor('sms'),
      deliveryStatus: 'estimated',
    })
    return true
  } catch (err: any) {
    logMessage({
      channel: 'sms',
      to: normalized,
      from: provider.from,
      body,
      kind,
      status: 'failed',
      error: err?.message,
      provider: provider.name,
    })
    return false
  }
}

// Marketing/campaign SMS — paired with the WhatsApp send so a campaign targeting a mobile reaches
// the customer on BOTH channels. Tagged with the campaign entity so the campaign detail page can
// show a per-campaign SMS log. Best-effort; shares the campaign's dedup with the WhatsApp send.
export async function sendCampaignSMS(params: {
  phone?: string | null
  body: string
  kind: string
  userId?: string | null
}): Promise<boolean> {
  const normalized = normalizePhone(params.phone)
  const skip = (why: string) => (console.warn(`[campaign-sms] ${params.kind} skipped: ${why}`), false)
  if (!normalized) return skip('invalid phone')
  if (!(await smsChannelEnabled())) return skip('SMS turned off')
  if (!(await messagingGateAllows('sms', true))) return skip('messaging wallet balance too low')
  const provider = await getSmsProvider()
  if (!provider.configured) return skip(`provider ${provider.name} not configured`)
  try {
    const sid = await provider.sendText(normalized, params.body)
    const { debitMessageEstimate } = await import('@/lib/shared/messaging/billing')
    const { estimateFor } = await import('@/lib/shared/messaging/pricing')
    debitMessageEstimate({ channel: 'sms', providerSid: sid }).catch(() => {})
    logMessage({
      channel: 'sms',
      to: normalized,
      from: provider.from,
      body: params.body,
      kind: params.kind,
      status: 'sent',
      providerSid: sid,
      userId: params.userId ?? null,
      entityType: 'campaign',
      entityId: params.kind,
      provider: provider.name,
      price: estimateFor('sms'),
      deliveryStatus: 'estimated',
    })
    return true
  } catch (err: any) {
    logMessage({
      channel: 'sms',
      to: normalized,
      from: provider.from,
      body: params.body,
      kind: params.kind,
      status: 'failed',
      error: err?.message,
      userId: params.userId ?? null,
      entityType: 'campaign',
      entityId: params.kind,
      provider: provider.name,
    })
    return false
  }
}

// ── Notification templates ────────────────────────────────────────────────────

async function orderLink(orderNumber: string): Promise<string> {
  return (await orderUrlByNumber(orderNumber)) ?? `${await storeBaseUrlAsync()}/account/orders`
}

// Each wrapper normalizes the phone, honors the kill switch, resolves store_name + any derived vars,
// then dispatches via sendByTemplate. Message body lives in the templates library (seed slug shown).
async function sendBySlug(
  phone: string | null | undefined,
  slug: string,
  variables: Record<string, string | number>,
  reference?: string
): Promise<boolean> {
  const normalized = normalizePhone(phone)
  if (!normalized) return false
  if (!(await smsChannelEnabled())) return false
  const { name: store_name } = await storeSignature()
  const res = await sendByTemplate({
    channel: 'sms',
    slug,
    to: normalized,
    variables: { store_name, ...variables },
    reference,
  })
  return res.status !== 'failed' && res.status !== 'skipped'
}

export async function sendOrderConfirmedSMS(params: {
  phone?: string | null
  orderNumber: string
  total: number
}): Promise<boolean> {
  const total = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(params.total)
  return sendBySlug(params.phone, 'order/confirmed', {
    order_number: params.orderNumber,
    total,
    short_url: await orderLink(params.orderNumber),
  })
}

export async function sendOrderShippedSMS(params: {
  phone?: string | null
  orderNumber: string
  trackingId?: string | null
  courier?: string | null
}): Promise<boolean> {
  return sendBySlug(params.phone, 'order/shipped', {
    order_number: params.orderNumber,
    courier: params.courier ?? '',
    awb: params.trackingId ?? '',
    short_url: await orderLink(params.orderNumber),
  })
}

export async function sendOrderDeliveredSMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(params.phone, 'order/delivered', {
    order_number: params.orderNumber,
    short_url: await orderLink(params.orderNumber),
  })
}

export async function sendAccessGrantedSMS(params: {
  phone?: string | null
  orderNumber: string
  vaultUrl: string
}): Promise<boolean> {
  return sendBySlug(params.phone, 'order/access-granted', {
    order_number: params.orderNumber,
    vault_url: params.vaultUrl,
  })
}

export async function sendOrderCancelledSMS(params: {
  phone?: string | null
  orderNumber: string
  reason?: string | null
}): Promise<boolean> {
  return sendBySlug(params.phone, 'order/cancelled', {
    order_number: params.orderNumber,
    refund_amount: '',
    reason: params.reason ?? '',
  })
}

export async function sendOTPSMS(params: { phone?: string | null; otp: string }): Promise<boolean> {
  return sendBySlug(params.phone, 'otp/verify', {
    code: params.otp,
    ttl_minutes: 10,
  })
}

export async function sendVariantChangeRequestedSMS(params: {
  phone?: string | null
  orderNumber: string
  orderUrl: string
}): Promise<boolean> {
  return sendBySlug(params.phone, 'order/variant-change-requested', {
    order_number: params.orderNumber,
    order_url: params.orderUrl,
  })
}

export async function sendPaymentFailedSMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(params.phone, 'order/payment-failed', {
    order_number: params.orderNumber,
    short_url: await orderLink(params.orderNumber),
  })
}

export async function sendOutForDeliverySMS(params: { phone?: string | null; orderNumber: string }): Promise<boolean> {
  return sendBySlug(params.phone, 'order/out-for-delivery', {
    order_number: params.orderNumber,
    customer_phone: '',
  })
}
