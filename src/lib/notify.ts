import { queryOne } from '@/lib/db'
import {
  sendOrderConfirmedSMS, sendOrderShippedSMS, sendOrderDeliveredSMS,
  sendOrderCancelledSMS, sendPaymentFailedSMS, sendOutForDeliverySMS,
  sendVariantChangeRequestedSMS,
} from '@/lib/sms'
import {
  sendOrderConfirmedWhatsApp, sendOrderShippedWhatsApp, sendOrderDeliveredWhatsApp,
  sendOrderCancelledWhatsApp, sendPaymentFailedWhatsApp, sendOutForDeliveryWhatsApp,
  sendVariantChangeRequestedWhatsApp,
} from '@/lib/whatsapp'

// Unified order-notification dispatcher.
// Always fire-and-forget. Routes each order event to the customer's chosen
// channel (sms | whatsapp). Email is sent separately by the caller.
// notification_channel = 'email' (default) → no SMS/WhatsApp here.

type Channel = 'email' | 'sms' | 'whatsapp' | null | undefined

interface Recipient {
  phone: string | null
  notification_channel: Channel
}

async function getRecipient(userId: string | null): Promise<Recipient | null> {
  if (!userId) return null
  return queryOne<Recipient>(
    'SELECT phone, notification_channel FROM users WHERE id = $1',
    [userId]
  )
}

function dispatch(
  channel: Channel,
  phone: string | null,
  sms: () => Promise<boolean>,
  whatsapp: () => Promise<boolean>
): void {
  if (!phone) return
  if (channel === 'sms') {
    sms().catch(() => {})
  } else if (channel === 'whatsapp') {
    // WhatsApp first; if it fails (e.g. template not yet approved), fall back to SMS.
    whatsapp().then(ok => { if (!ok) sms().catch(() => {}) }).catch(() => { sms().catch(() => {}) })
  }
}

export async function notifyOrderConfirmed(userId: string | null, orderNumber: string, total: number): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendOrderConfirmedSMS({ phone: r.phone, orderNumber, total }),
    () => sendOrderConfirmedWhatsApp({ phone: r.phone, orderNumber, total }))
}

export async function notifyOrderShipped(userId: string | null, orderNumber: string, courier?: string | null, trackingId?: string | null): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendOrderShippedSMS({ phone: r.phone, orderNumber, courier, trackingId }),
    () => sendOrderShippedWhatsApp({ phone: r.phone, orderNumber, courier, trackingId }))
}

export async function notifyOrderDelivered(userId: string | null, orderNumber: string): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendOrderDeliveredSMS({ phone: r.phone, orderNumber }),
    () => sendOrderDeliveredWhatsApp({ phone: r.phone, orderNumber }))
}

export async function notifyOrderCancelled(userId: string | null, orderNumber: string): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendOrderCancelledSMS({ phone: r.phone, orderNumber }),
    () => sendOrderCancelledWhatsApp({ phone: r.phone, orderNumber }))
}

export async function notifyOutForDelivery(userId: string | null, orderNumber: string): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendOutForDeliverySMS({ phone: r.phone, orderNumber }),
    () => sendOutForDeliveryWhatsApp({ phone: r.phone, orderNumber }))
}

export async function notifyPaymentFailed(userId: string | null, orderNumber: string): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendPaymentFailedSMS({ phone: r.phone, orderNumber }),
    () => sendPaymentFailedWhatsApp({ phone: r.phone, orderNumber }))
}

// Admin-initiated variant change awaiting the customer's approval. Needs the
// order deep-link, so the caller passes a prebuilt URL. WhatsApp uses the
// variant-change template (falls back to SMS if not yet configured).
export async function notifyVariantChangeRequested(userId: string | null, orderNumber: string, orderUrl: string): Promise<void> {
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(r.notification_channel, r.phone,
    () => sendVariantChangeRequestedSMS({ phone: r.phone, orderNumber, orderUrl }),
    () => sendVariantChangeRequestedWhatsApp({ phone: r.phone, orderNumber, url: orderUrl, entity: { entityType: 'orders' } }))
}
