import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { PLATFORM_TENANT_ID } from '@/lib/import/jobs'

// Whose integration credentials an admin request manages: the store's own, or for the flagship the
// platform's, kept under the platform tenant id. Both use the same gear, sign-in and storage.
export async function credentialOwnerId(): Promise<string> {
  return (await resolveTenant())?.tenantId ?? PLATFORM_TENANT_ID
}

export const isPlatformOwner = (id: string | null | undefined) => id === PLATFORM_TENANT_ID
