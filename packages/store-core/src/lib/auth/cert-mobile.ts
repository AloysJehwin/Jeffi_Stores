import 'server-only'
import { controlPlanePool, lookupTenantContextById } from '@/lib/tenant-registry'
import { runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { platformBrandName } from '@/lib/catalog/brand'
import { activeAdminByEmail, type AdminMobileRow, type AdminStore } from '@/lib/auth/admin-mobile'

// The certificate portal asks for a verified mobile number before the first download. A certificate
// belongs to one store (or the platform), so the admin and its number are read in that store.

export const certNeedsMobileCheck = () => process.env.CERTPORTAL_REQUIRE_MOBILE !== 'false'

export interface CertStore {
  store: AdminStore
  storeName: string
  admin: AdminMobileRow | null
}

/** Runs fn inside the store a certificate belongs to, with the active admin for the signed-in email. */
export async function inCertStore<T>(tenantId: string | null, storeName: string | null, email: string, fn: (c: CertStore) => Promise<T>): Promise<T | null> {
  const run = async () => fn({ store: tenantId, storeName: storeName || platformBrandName(), admin: await activeAdminByEmail(email) })
  if (!tenantId) return run()
  const ctx = await lookupTenantContextById(tenantId)
  return ctx ? runWithTenantContext(ctx, run) : null
}

/** The signed-in admin's certificate by serial, if it can still be downloaded. */
export async function downloadableCert(serial: string, email: string) {
  const { rows } = await controlPlanePool().query(
    `SELECT tenant_id::text, store_name FROM portal_certs
      WHERE serial = $1 AND lower(issued_to) = lower($2) AND revoked_at IS NULL AND expires_at > now() AND downloaded_at IS NULL`,
    [serial, email]
  )
  return (rows[0] as { tenant_id: string | null; store_name: string | null } | undefined) ?? null
}
