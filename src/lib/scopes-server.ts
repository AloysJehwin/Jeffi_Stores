import { ALL_SCOPE_KEYS, TENANT_SCOPE_KEYS } from './scopes'

/**
 * The scopes a caller may assign to a team member. The API validated against ALL_SCOPE_KEYS,
 * so a tenant owner — who is super_admin — could grant control-plane scopes over the wire even
 * though the UI hides them. A tenant can only hand out what its own plan sells.
 *
 * Server-only by construction: it reaches the control plane (pg) via plan-gate. It lives apart
 * from scopes.ts so a client component importing scope metadata never drags the Postgres driver
 * into the browser bundle — only server routes import this module.
 */
export async function assignableScopeKeys(tenantId: string | null): Promise<string[]> {
  if (!tenantId) return ALL_SCOPE_KEYS
  try {
    const { getTenantPlan } = await import('./plan-gate')
    const { scopes } = await getTenantPlan(tenantId)
    if (scopes.size > 0) return TENANT_SCOPE_KEYS.filter(k => scopes.has(k))
  } catch {
    /* fall through */
  }
  return TENANT_SCOPE_KEYS
}
