import 'server-only'
import { getVaultSession, type VaultSession } from '@/lib/vault/session'

export type { VaultSession }

// getVaultSession already asserts the request tenant. Don't re-check with getCurrentTenantId():
// it is null in route handlers and would lock out every tenant's buyers.
export async function requireVaultSession(): Promise<VaultSession | null> {
  return getVaultSession().catch(() => null)
}
