import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { customerBaseUrl } from '@/lib/shared/customer-links'
import { SUBSCRIPTION_INTERVAL_LABELS, isSubscriptionInterval } from '@/lib/subscriptions/intervals'
import {
  sendAuditedMail,
  mailShell,
  escapeHtml,
  customerMailFromAsync,
  currentBrandNameAsync,
  storeContactLine,
  storeAddressLine,
} from './shared'

interface SubMailRow {
  id: string
  user_id: string
  status: string
  interval: string | null
  quantity: string
  unit_price_paise: string | null
  shipping_paise: string
  current_end: string | null
  access_expires_at: string | null
  cancel_at_cycle_end: boolean
  is_digital: boolean
  email: string | null
  first_name: string | null
  product_name: string
}

async function loadSub(subscriptionId: string): Promise<SubMailRow | null> {
  return queryOne<SubMailRow>(
    `SELECT s.id::text, s.user_id::text, s.status, s.interval, s.quantity::text,
            s.unit_price_paise::text, s.shipping_paise::text, s.current_end::text,
            s.access_expires_at::text, s.cancel_at_cycle_end, s.is_digital,
            u.email, u.first_name, p.name AS product_name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN products p ON p.id = s.product_id
      WHERE s.id = $1`,
    [subscriptionId]
  )
}

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null

function cycleAmount(s: SubMailRow): number {
  return Math.round(Number(s.unit_price_paise || 0) * Number(s.quantity || 1) + Number(s.shipping_paise || 0))
}

function intervalLabel(s: SubMailRow): string {
  return isSubscriptionInterval(s.interval) ? SUBSCRIPTION_INTERVAL_LABELS[s.interval] : 'Recurring'
}

async function send(
  subscriptionId: string,
  templateName: string,
  build: (s: SubMailRow, ctx: { brand: string; manageUrl: string }) => { subject: string; kicker: string; title: string; content: string }
): Promise<void> {
  try {
    const sub = await loadSub(subscriptionId)
    if (!sub?.email) return
    const [brand, from, contactLine, address, base] = await Promise.all([
      currentBrandNameAsync(),
      customerMailFromAsync(),
      storeContactLine(),
      storeAddressLine(),
      customerBaseUrl(sub.user_id),
    ])
    const manageUrl = `${base}/account/subscriptions`
    const m = build(sub, { brand, manageUrl })
    const html = mailShell({
      brand,
      kicker: m.kicker,
      title: m.title,
      preheader: m.subject,
      content: `<p>Hello ${escapeHtml(sub.first_name || 'Customer')},</p>${m.content}
        <div class="cta"><a href="${manageUrl}" class="button" style="color:#ffffff;">Manage subscription</a></div>`,
      footerLines: [address, contactLine],
    })
    await sendAuditedMail({
      from,
      to: sub.email,
      subject: m.subject,
      html,
      kind: 'subscription',
      templateName,
      entityType: 'subscriptions',
      entityId: sub.id,
      userId: sub.user_id,
    })
  } catch {
    // Notifications must never break the subscription flow.
  }
}

export async function sendSubscriptionStartedEmail(subscriptionId: string): Promise<void> {
  await send(subscriptionId, 'subscription_started', (s, { brand }) => {
    const next = fmtDate(s.current_end)
    return {
      subject: `Your ${s.product_name} subscription is active - ${brand}`,
      kicker: 'Subscription',
      title: 'Subscription started',
      content: `
        <p>Your subscription to <strong>${escapeHtml(s.product_name)}</strong> is now active.</p>
        <ul>
          <li>Billing: ${intervalLabel(s)} &middot; ${inr(cycleAmount(s))} per cycle</li>
          ${next ? `<li>Next charge: ${next}</li>` : ''}
        </ul>
        <p>Each cycle is charged automatically through your payment mandate. You can pause or cancel any time from My subscriptions; a cancellation takes effect at the end of the current cycle.</p>`,
    }
  })
}

export async function sendSubscriptionPaymentFailedEmail(subscriptionId: string): Promise<void> {
  await send(subscriptionId, 'subscription_payment_failed', (s, { brand }) => {
    const until = fmtDate(s.access_expires_at || s.current_end)
    return {
      subject: `Payment failed for your ${s.product_name} subscription - ${brand}`,
      kicker: 'Subscription',
      title: 'We could not renew your subscription',
      content: `
        <div class="warning"><strong>Your latest ${intervalLabel(s).toLowerCase()} payment of ${inr(cycleAmount(s))} for ${escapeHtml(s.product_name)} could not be collected after several retries.</strong></div>
        <p>${s.is_digital && until ? `Your access remains available until ${until}. ` : ''}No further deliveries or charges will be made until the mandate is restored. Please check your bank or UPI app, or start a new subscription from your account.</p>`,
    }
  })
}

export async function sendSubscriptionCancelledEmail(subscriptionId: string): Promise<void> {
  await send(subscriptionId, 'subscription_cancelled', (s, { brand }) => {
    const end = fmtDate(s.access_expires_at || s.current_end)
    const pending = s.cancel_at_cycle_end && s.status !== 'cancelled'
    return {
      subject: `Your ${s.product_name} subscription ${pending ? 'will end' : 'has been cancelled'} - ${brand}`,
      kicker: 'Subscription',
      title: pending ? 'Cancellation scheduled' : 'Subscription cancelled',
      content: `
        <p>Your subscription to <strong>${escapeHtml(s.product_name)}</strong> ${
          pending ? `will end at the close of the current cycle${end ? ` on ${end}` : ''}` : 'has been cancelled'
        }. No further payments will be collected.</p>
        ${s.is_digital && end ? `<p>You keep access until ${end}.</p>` : ''}`,
    }
  })
}
