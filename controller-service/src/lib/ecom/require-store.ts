import { redirect } from 'next/navigation'
import { hasService } from '@/lib/tenant-registry'

const ADD_STORE_HREF = '/dashboard/add-store'

/** Store-only console pages (nav `requires: 'store'`) call this after loadOwnerContext(): a workspace without the store goes to Add a store. */
export function requireStore(tenant: { service_types?: string[] | null }): void {
  if (!hasService(tenant, 'store')) redirect(ADD_STORE_HREF)
}
