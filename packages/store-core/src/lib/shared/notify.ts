import { queryOne } from '@/lib/shared/db'
import {
  sendOrderConfirmedSMS,
  sendOrderShippedSMS,
  sendOrderDeliveredSMS,
  sendAccessGrantedSMS,
  sendOrderCancelledSMS,
  sendPaymentFailedSMS,
  sendOutForDeliverySMS,
  sendVariantChangeRequestedSMS,
} from '@/lib/shared/sms'
import {
  sendOrderConfirmedWhatsApp,
  sendOrderShippedWhatsApp,
  sendOrderDeliveredWhatsApp,
  sendAccessGrantedWhatsApp,
  sendOrderCancelledWhatsApp,
  sendPaymentFailedWhatsApp,
  sendOutForDeliveryWhatsApp,
  sendVariantChangeRequestedWhatsApp,
} from '@/lib/shared/whatsapp'
import { notifyPush } from '@/lib/push/notify'

// Unified order-notification dispatcher.
// Always fire-and-forget. Routes each order event to the customer's chosen
// channel (sms | whatsapp). Email is sent separately by the caller.
// notification_channel = 'email' (default) → no SMS/WhatsApp here.
// Every event also lands in the app inbox and goes out as an app push (pushOrder), whatever the channel.

type Channel = 'email' | 'sms' | 'whatsapp' | null | undefined

interface Recipient {
  phone: string | null
  notification_channel: Channel
}

async function getRecipient(userId: string | null): Promise<Recipient | null> {
  if (!userId) return null
  return queryOne<Recipient>('SELECT phone, notification_channel FROM users WHERE id = $1', [userId])
}

// Inbox row + app push for an order event. Detached so it never delays or fails the SMS/WhatsApp path.
function pushOrder(userId: string | null, orderNumber: string, type: string, title: string, body: string): void {
  if (!userId) return
  ;(async () => {
    const order = await queryOne<{ id: string }>('SELECT id FROM orders WHERE order_number = $1', [orderNumber]).catch(() => null)
    const id = typeof order?.id === 'string' ? order.id : null
    await notifyPush(userId, {
      category: 'orders',
      type,
      title,
      body,
      link: id ? `/account/orders/${id}` : '/account/orders',
      source: 'transactional',
      sourceRef: id ?? orderNumber,
      collapseKey: `order-${orderNumber}`.slice(0, 64),
    })
  })().catch(() => {})
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

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
    whatsapp()
      .then(ok => {
        if (!ok) sms().catch(() => {})
      })
      .catch(() => {
        sms().catch(() => {})
      })
  }
}

export async function notifyOrderConfirmed(userId: string | null, orderNumber: string, total: number): Promise<void> {
  pushOrder(userId, orderNumber, 'order_confirmed', 'Order confirmed', `Order ${orderNumber} for ${rupees(total)} is confirmed. We'll tell you when it ships.`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendOrderConfirmedSMS({ phone: r.phone, orderNumber, total }),
    () => sendOrderConfirmedWhatsApp({ phone: r.phone, orderNumber, total })
  )
}

export async function notifyOrderShipped(
  userId: string | null,
  orderNumber: string,
  courier?: string | null,
  trackingId?: string | null
): Promise<void> {
  pushOrder(
    userId,
    orderNumber,
    'order_shipped',
    'Your order has shipped',
    `Order ${orderNumber} is on its way${courier ? ` with ${courier}` : ''}${trackingId ? ` (tracking ${trackingId})` : ''}.`
  )
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendOrderShippedSMS({ phone: r.phone, orderNumber, courier, trackingId }),
    () => sendOrderShippedWhatsApp({ phone: r.phone, orderNumber, courier, trackingId })
  )
}

export async function notifyOrderDelivered(userId: string | null, orderNumber: string): Promise<void> {
  pushOrder(userId, orderNumber, 'order_delivered', 'Delivered', `Order ${orderNumber} has been delivered. Enjoy!`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendOrderDeliveredSMS({ phone: r.phone, orderNumber }),
    () => sendOrderDeliveredWhatsApp({ phone: r.phone, orderNumber })
  )
}

export async function notifyAccessGranted(userId: string | null, orderNumber: string): Promise<void> {
  pushOrder(userId, orderNumber, 'access_granted', 'Your digital items are ready', `Order ${orderNumber}: open your order to view or download them.`)
  const r = await getRecipient(userId)
  if (!r) return
  const { vaultLibraryUrl } = await import('@/lib/vault/links')
  const vaultUrl = await vaultLibraryUrl()
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendAccessGrantedSMS({ phone: r.phone, orderNumber, vaultUrl }),
    () => sendAccessGrantedWhatsApp({ phone: r.phone, orderNumber, vaultUrl })
  )
}

export async function notifyOrderCancelled(userId: string | null, orderNumber: string): Promise<void> {
  pushOrder(userId, orderNumber, 'order_cancelled', 'Order cancelled', `Order ${orderNumber} has been cancelled.`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendOrderCancelledSMS({ phone: r.phone, orderNumber }),
    () => sendOrderCancelledWhatsApp({ phone: r.phone, orderNumber })
  )
}

export async function notifyOutForDelivery(userId: string | null, orderNumber: string): Promise<void> {
  pushOrder(userId, orderNumber, 'out_for_delivery', 'Out for delivery', `Order ${orderNumber} is out for delivery and should reach you today.`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendOutForDeliverySMS({ phone: r.phone, orderNumber }),
    () => sendOutForDeliveryWhatsApp({ phone: r.phone, orderNumber })
  )
}

export async function notifyPaymentFailed(userId: string | null, orderNumber: string): Promise<void> {
  pushOrder(userId, orderNumber, 'payment_failed', 'Payment failed', `We couldn't complete the payment for order ${orderNumber}. You can try again from your order.`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendPaymentFailedSMS({ phone: r.phone, orderNumber }),
    () => sendPaymentFailedWhatsApp({ phone: r.phone, orderNumber })
  )
}

// Admin-initiated variant change awaiting the customer's approval. Needs the
// order deep-link, so the caller passes a prebuilt URL. WhatsApp uses the
// variant-change template (falls back to SMS if not yet configured).
export async function notifyVariantChangeRequested(
  userId: string | null,
  orderNumber: string,
  orderUrl: string
): Promise<void> {
  pushOrder(userId, orderNumber, 'variant_change_requested', 'Approve a change to your order', `We've proposed a change to order ${orderNumber}. Review it to continue.`)
  const r = await getRecipient(userId)
  if (!r) return
  dispatch(
    r.notification_channel,
    r.phone,
    () => sendVariantChangeRequestedSMS({ phone: r.phone, orderNumber, orderUrl }),
    () =>
      sendVariantChangeRequestedWhatsApp({
        phone: r.phone,
        orderNumber,
        url: orderUrl,
        entity: { entityType: 'orders' },
      })
  )
}
