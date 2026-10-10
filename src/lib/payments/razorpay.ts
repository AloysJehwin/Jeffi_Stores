import Razorpay from 'razorpay'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { resolveRazorpayCreds, type RazorpayCreds } from '@/lib/integrations/resolve'

export function getRazorpayInstance() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

/** Per-tenant Razorpay client: uses the tenant's own key_id/key_secret when they have connected
 * their account (own_razorpay), else the platform env keys. Returns the resolved creds alongside
 * the instance so callers can surface `key_id` to the browser checkout and branch on `isOwn`.
 * The env-only `getRazorpayInstance()` stays for platform-account Route-lifecycle operations
 * (linked-account create/update/settlement) that must never run on a tenant's keys. */
export async function getRazorpayInstanceFor(tenantId?: string): Promise<{ instance: Razorpay; creds: RazorpayCreds }> {
  const creds = await resolveRazorpayCreds(tenantId)
  if (!creds.key_id || !creds.key_secret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set')
  }
  return {
    instance: new Razorpay({ key_id: creds.key_id, key_secret: creds.key_secret }),
    creds,
  }
}

export async function isRazorpayEnabled(): Promise<boolean> {
  return (await getFeatureFlags()).razorpayEnabled
}

/**
 * Cancel the open payment artifacts tied to an order/invoice — the Razorpay payment link and QR
 * code — when the invoice is cancelled, so a buyer can no longer pay a voided invoice. Best-effort
 * and never throws: a cancel must not be blocked by a Razorpay hiccup, and an already
 * cancelled/paid/expired artifact is treated as success. Returns what it acted on for the audit log.
 * Uses the tenant's own keys when they collect on their own account.
 */
export async function cancelInvoicePaymentArtifacts(opts: {
  tenantId?: string | null
  paymentLinkId?: string | null
  paymentLinkStatus?: string | null
  qrId?: string | null
}): Promise<{ paymentLink: 'cancelled' | 'skipped' | 'error' | 'none'; qr: 'closed' | 'skipped' | 'error' | 'none' }> {
  const out = { paymentLink: 'none' as const, qr: 'none' as const } as {
    paymentLink: 'cancelled' | 'skipped' | 'error' | 'none'
    qr: 'closed' | 'skipped' | 'error' | 'none'
  }
  let instance: Razorpay
  try {
    ;({ instance } = await getRazorpayInstanceFor(opts.tenantId ?? undefined))
  } catch {
    // No keys configured — nothing to cancel at the gateway.
    return out
  }

  if (opts.paymentLinkId) {
    // Only an open link can be cancelled; paid/cancelled/expired already can't collect.
    if (opts.paymentLinkStatus && ['paid', 'cancelled', 'expired'].includes(opts.paymentLinkStatus)) {
      out.paymentLink = 'skipped'
    } else {
      try {
        await (instance.paymentLink as any).cancel(opts.paymentLinkId)
        out.paymentLink = 'cancelled'
      } catch (e: any) {
        // Razorpay rejects cancelling a non-cancellable link — benign for our purpose.
        out.paymentLink = /cannot be cancelled|already/i.test(e?.error?.description || e?.message || '') ? 'skipped' : 'error'
        if (out.paymentLink === 'error') console.error('[razorpay] payment link cancel failed', opts.paymentLinkId, e?.message)
      }
    }
  }

  if (opts.qrId) {
    try {
      await (instance.qrCode as any).close(opts.qrId)
      out.qr = 'closed'
    } catch (e: any) {
      out.qr = /already closed|closed/i.test(e?.error?.description || e?.message || '') ? 'skipped' : 'error'
      if (out.qr === 'error') console.error('[razorpay] qr close failed', opts.qrId, e?.message)
    }
  }

  return out
}
