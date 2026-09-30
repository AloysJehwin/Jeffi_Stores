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
