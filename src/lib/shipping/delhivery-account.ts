import { controlPlanePool } from '@/lib/tenant-registry'
import { hasOwnDelhiveryToken } from '@/lib/integrations/resolve'
import { isFlagshipTenant } from '@/lib/payments/wallet'

export type ShippingAccountMode = 'flagship' | 'own' | 'platform'

/**
 * Which Delhivery account a NEW shipment for this tenant goes on, or an error when the tenant's
 * mode and its stored token disagree. resolveDelhiveryToken uses a tenant token whenever one is on
 * file and falls back to the platform key otherwise, so a mismatch would either ship on the
 * platform account unpaid (own mode, token removed) or bill the wallet for a shipment Delhivery
 * charges the tenant directly (platform mode, stale own token). Both are refused.
 */
export async function resolveShippingAccount(
  tenantId: string | null | undefined
): Promise<{ ok: true; mode: ShippingAccountMode } | { ok: false; error: string }> {
  if (isFlagshipTenant(tenantId)) return { ok: true, mode: 'flagship' }
  const res = await controlPlanePool()
    .query(`SELECT own_delhivery FROM tenants WHERE id = $1`, [tenantId])
    .catch(() => null)
  if (!res?.rows[0]) return { ok: false, error: 'Could not read the store delivery account. Try again shortly.' }
  const own = res.rows[0].own_delhivery === true
  const hasToken = await hasOwnDelhiveryToken(tenantId as string).catch(() => null)
  if (hasToken == null) return { ok: false, error: 'Could not read the store delivery account. Try again shortly.' }
  if (own && !hasToken) {
    return {
      ok: false,
      error: 'This store ships on its own Delhivery account but no Delhivery API token is connected. Connect it first.',
    }
  }
  if (!own && hasToken) {
    return {
      ok: false,
      error:
        'This store is set to ship on the platform Delhivery account but an own Delhivery token is still connected. Contact support to finish the account switch.',
    }
  }
  return { ok: true, mode: own ? 'own' : 'platform' }
}
