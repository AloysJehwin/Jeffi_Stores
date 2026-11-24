import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ROOT_DOMAIN } from '@/lib/tenant-registry/shared'
import { sendBillingEmail } from '@/lib/shared/ecom-emails'

// Owner emails about the workspace's subscription. Lines are HTML.

export type BillingNotice =
  | { kind: 'payment_pending'; amountInr: number; payUrl: string | null }
  | { kind: 'halted'; graceUntil: string; store: boolean }
  | { kind: 'trial_ending'; site: string; endsAt: string }
  | { kind: 'trial_ended'; site: string }
  | { kind: 'site_paused'; site: string }
  | { kind: 'migrate_announce' | 'migrate_remind'; deadline: string; items: string[] }
  | { kind: 'migrate_ended'; items: string[] }

const CONSOLE = `https://ecom.${ROOT_DOMAIN}/dashboard`
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
export const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)

async function ownerOf(tenantId: string): Promise<{ email: string; name: string | null; slug: string } | null> {
  const r = await controlPlanePool().query<{ email: string; name: string | null; slug: string }>(
    `SELECT o.email, o.name, t.slug FROM owner_tenants ot JOIN owners o ON o.id = ot.owner_id JOIN tenants t ON t.id = ot.tenant_id
      WHERE ot.tenant_id = $1 ORDER BY ot.created_at LIMIT 1`,
    [tenantId]
  )
  return r.rows[0] ?? null
}

export async function notifyBilling(tenantId: string, n: BillingNotice): Promise<void> {
  const owner = await ownerOf(tenantId)
  if (!owner?.email) return
  const q = `?tenant=${encodeURIComponent(owner.slug)}`
  const billing = { href: `${CONSOLE}/billing${q}`, label: 'Open billing' }
  const subscribe = { href: `${CONSOLE}/billing/subscribe${q}`, label: 'Set up your subscription' }
  const to = { email: owner.email, name: owner.name }
  const list = (items: string[]) => `<ul style="margin:0 0 14px;padding-left:18px;">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`

  switch (n.kind) {
    case 'payment_pending':
      return sendBillingEmail(to, {
        subject: 'Your Jeffi payment did not go through',
        title: 'Update your payment method',
        lines: [`We couldn't collect ${inr(n.amountInr)} for your subscription. Razorpay will try again; everything keeps running meanwhile.`],
        cta: n.payUrl ? { href: n.payUrl, label: 'Update payment' } : billing,
      })
    case 'halted':
      return sendBillingEmail(to, {
        subject: 'Your Jeffi subscription is on hold',
        title: 'Your subscription is on hold',
        lines: [
          'Razorpay stopped retrying the payment for your subscription.',
          n.store ? 'Your store is suspended until it is paid.' : 'Everything keeps running for now.',
        ],
        warn: `Sites go offline and add-ons stop on ${day(n.graceUntil)} unless it is paid. Pay now from Billing.`,
        cta: billing,
      })
    case 'trial_ending':
      return sendBillingEmail(to, {
        subject: `${n.site}: your free trial ends on ${day(n.endsAt)}`,
        title: 'Your free trial ends soon',
        lines: [`The free trial of <strong>${esc(n.site)}</strong> ends on <strong>${day(n.endsAt)}</strong>. Set up autopay to keep it online.`],
        cta: billing,
      })
    case 'trial_ended':
    case 'site_paused':
      return sendBillingEmail(to, {
        subject: `${n.site} is offline`,
        title: 'Your site is offline',
        lines: [
          n.kind === 'trial_ended'
            ? `The free trial of <strong>${esc(n.site)}</strong> ended without a subscription, so we paused it. Your page and its enquiries are kept.`
            : `We paused <strong>${esc(n.site)}</strong> because its hosting isn't paid. Your page and its enquiries are kept.`,
          'Add it to your subscription to bring it back.',
        ],
        cta: billing,
      })
    case 'migrate_announce':
    case 'migrate_remind':
      return sendBillingEmail(to, {
        subject: n.kind === 'migrate_announce' ? 'Jeffi is moving to one monthly subscription' : `Set up your subscription before ${day(n.deadline)}`,
        title: 'One monthly subscription',
        lines: [
          'Monthly charges no longer come out of your wallet. They move to one Razorpay subscription with one monthly payment:',
          list(n.items),
          'Any time you already paid for from the wallet is credited back to it. The wallet stays for usage (messages, documents, AI).',
        ],
        warn: `Set it up by ${day(n.deadline)} to keep everything running.`,
        cta: subscribe,
      })
    case 'migrate_ended':
      return sendBillingEmail(to, {
        subject: 'Some Jeffi services have stopped',
        title: 'Some services have stopped',
        lines: ['These were paid from the wallet and were not moved to a subscription in time:', list(n.items), 'Set up your subscription to bring them back.'],
        cta: subscribe,
      })
  }
}
