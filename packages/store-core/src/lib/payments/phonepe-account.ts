import 'server-only'
import { resolveRequestTenant } from '@/lib/shared/db'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'
import { type UpiMode } from '@/lib/tenant-registry'
import { isFlagship } from '@/lib/payments/webhook-tenant'
import { pinnedTenantSlug } from '@/lib/service-routing'
import { resolveUpiMode } from '@/lib/payments/upi/creds'

/**
 * Whose UPI collection the current admin request is about: the platform's (the flagship; PhonePe
 * creds saved under PLATFORM_TENANT_ID, else env) or a store's. Saved PhonePe credentials make that
 * merchant collect on PhonePe at once. Mirrors rzp-account.
 */
export interface PhonePeAccount {
  kind: 'platform' | 'store'
  /** The store's tenant id; null for the platform. */
  tenantId: string | null
  /** Where its credentials are saved (tenant_integration_credentials.tenant_id). */
  credTenantId: string
  slug: string | null
  upiMode: UpiMode
}

/** The PhonePe part of GET /api/admin/integrations/upi (and /phonepe). Secrets never leave the server. */
export interface PhonePeAccountInfo {
  kind: 'platform' | 'store'
  upiMode: UpiMode
  editable: boolean
  /** A decryptable blob is saved (platform: or the env creds are set). */
  connected: boolean
  /** Platform only: the credentials in use come from the server environment, not a saved blob. */
  fromEnv?: boolean
  env: 'sandbox' | 'production' | null
  clientId: string | null
  clientVersion: string | null
  merchantId: string | null
  webhookAuthSet: boolean
  webhookUrl: string | null
  /** The merchant's UPI ID (UPG). */
  upiId: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export async function phonePeAccountFor(): Promise<PhonePeAccount> {
  const t = await resolveRequestTenant()
  // A store's own pod with no tenant resolved must not fall through to the platform account.
  if (!t && pinnedTenantSlug()) throw new Error(`Store ${pinnedTenantSlug()} could not be resolved`)
  if (!t || isFlagship({ tenantId: t.tenantId })) return { kind: 'platform', tenantId: null, credTenantId: PLATFORM_TENANT_ID, slug: null, upiMode: 'auto' }
  return { kind: 'store', tenantId: t.tenantId, credTenantId: t.tenantId, slug: t.slug ?? null, upiMode: await resolveUpiMode(t.tenantId) }
}
