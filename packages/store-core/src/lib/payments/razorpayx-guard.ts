import 'server-only'
import { resolveRequestTenant } from '@/lib/shared/db'
import { pinnedTenantSlug } from '@/lib/service-routing'
import { isFlagship } from '@/lib/payments/webhook-tenant'

export const PLATFORM_PAYOUTS_ONLY = 'RazorpayX payouts are only available on the main store. Record this payment manually.'

/**
 * The RAZORPAYX_* keys are the platform's payout account (store pods carry them too, through jeffi/store):
 * only the flagship may move money with them. Fails closed on a pod pinned to a store.
 */
export async function platformPayoutsAllowed(): Promise<boolean> {
  if (pinnedTenantSlug()) return false
  const t = await resolveRequestTenant().catch(() => undefined)
  return t !== undefined && isFlagship(t)
}
