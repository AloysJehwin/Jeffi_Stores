import { controlPlanePool } from './tenant-registry'

// In-process cache: tenantId → { scopes: Set<string>, plan: string, expiresAt: number }
const cache = new Map<string, { scopes: Set<string>; plan: string; expiresAt: number }>()
const TTL_MS = 60_000

// Plans in tier order — used to determine upgrade path
const PLAN_TIERS: Record<string, number> = { basic: 1, growth: 2, pro: 3, enterprise: 4 }
const TIER_PLANS = ['basic', 'growth', 'pro', 'enterprise']

// Minimum plan required per scope key — derived from plan_features table.
// Used to tell callers which plan they need to upgrade to.
// Computed lazily and cached for the process lifetime.
let scopeMinPlan: Record<string, string> | null = null

async function getScopeMinPlan(): Promise<Record<string, string>> {
  if (scopeMinPlan) return scopeMinPlan
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT p.slug, p.tier, pf.scope_key
     FROM plan_features pf JOIN plans p ON p.id = pf.plan_id
     ORDER BY p.tier ASC`
  )
  const map: Record<string, string> = {}
  for (const row of res.rows) {
    if (!map[row.scope_key]) map[row.scope_key] = row.slug
  }
  scopeMinPlan = map
  return map
}

async function loadTenantScopes(tenantId: string): Promise<{ scopes: Set<string>; plan: string }> {
  const pool = controlPlanePool()
  const res = await pool.query(
    `SELECT p.slug AS plan, array_agg(pf.scope_key) AS scopes
     FROM tenants t
     JOIN plans p ON p.id = t.plan_id
     LEFT JOIN plan_features pf ON pf.plan_id = t.plan_id
     WHERE t.id = $1
     GROUP BY p.slug`,
    [tenantId]
  )
  const row = res.rows[0]
  if (!row) return { scopes: new Set(), plan: 'basic' }
  return {
    plan: row.plan,
    scopes: new Set<string>(row.scopes?.filter(Boolean) ?? []),
  }
}

function getCached(tenantId: string) {
  const entry = cache.get(tenantId)
  if (entry && Date.now() < entry.expiresAt) return entry
  cache.delete(tenantId)
  return null
}

export interface PlanGateResult {
  allowed: boolean
  plan: string
  upgradeRequired: string | null // minimum plan slug needed, or null if allowed
}

/**
 * Check whether a tenant's plan includes a given scope.
 * Caches the plan scope set for 60s to avoid hammering the control-plane DB on every request.
 *
 * Usage:
 *   const gate = await planGate(tenantId, 'returns:read')
 *   if (!gate.allowed) return NextResponse.json({ error: `Upgrade to ${gate.upgradeRequired}` }, { status: 403 })
 */
export async function planGate(tenantId: string, scopeKey: string): Promise<PlanGateResult> {
  let entry = getCached(tenantId)
  if (!entry) {
    const { scopes, plan } = await loadTenantScopes(tenantId)
    entry = { scopes, plan, expiresAt: Date.now() + TTL_MS }
    cache.set(tenantId, entry)
  }

  const allowed = entry.scopes.has(scopeKey)
  if (allowed) return { allowed: true, plan: entry.plan, upgradeRequired: null }

  const minPlanMap = await getScopeMinPlan()
  const upgradeRequired = minPlanMap[scopeKey] ?? null
  return { allowed: false, plan: entry.plan, upgradeRequired }
}

/**
 * Check multiple scopes at once — all must be allowed.
 */
export async function planGateAll(tenantId: string, scopeKeys: string[]): Promise<PlanGateResult> {
  for (const key of scopeKeys) {
    const result = await planGate(tenantId, key)
    if (!result.allowed) return result
  }
  const entry = getCached(tenantId)
  return { allowed: true, plan: entry?.plan ?? 'basic', upgradeRequired: null }
}

/**
 * Get the full plan info for a tenant (plan slug + all scopes).
 * Useful for rendering plan-gated UI sections.
 */
export async function getTenantPlan(tenantId: string): Promise<{ plan: string; scopes: Set<string> }> {
  let entry = getCached(tenantId)
  if (!entry) {
    const { scopes, plan } = await loadTenantScopes(tenantId)
    entry = { scopes, plan, expiresAt: Date.now() + TTL_MS }
    cache.set(tenantId, entry)
  }
  return { plan: entry.plan, scopes: entry.scopes }
}

/**
 * A scope the admin's ROLE grants, narrowed by what the tenant's PLAN sells.
 * The platform's own admin (no tenant in context) is never plan-limited.
 */
export async function hasPlanScope(role: string, roleScopes: string[], scopeKey: string): Promise<boolean> {
  const { hasScope } = await import('./scopes')
  if (!hasScope(role, roleScopes, scopeKey)) return false
  const { resolveTenantId } = await import('./tenant-context')
  const tenantId = await resolveTenantId()
  if (!tenantId) return true
  const { scopes } = await getTenantPlan(tenantId)
  return scopes.has(scopeKey)
}

/**
 * Invalidate the cache for a tenant — call after plan upgrades/downgrades.
 */
export function invalidatePlanCache(tenantId: string): void {
  cache.delete(tenantId)
  scopeMinPlan = null
}

/**
 * Convenience: get plan from the current TenantContext (for storefront API routes).
 * The platform's own store is never plan-limited; a tenant host whose tenant cannot be
 * resolved is denied rather than treated as the platform.
 */
export async function currentTenantPlanGate(scopeKey: string): Promise<PlanGateResult> {
  const { resolveTenantId } = await import('./tenant-context')
  const tenantId = await resolveTenantId()
  if (!tenantId) {
    if (await isTenantHostRequest()) return { allowed: false, plan: 'unknown', upgradeRequired: null }
    return { allowed: true, plan: 'platform', upgradeRequired: null }
  }
  return planGate(tenantId, scopeKey)
}

// Middleware sets these headers only for hosts it resolved to a tenant.
async function isTenantHostRequest(): Promise<boolean> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    return !!(h.get('x-tenant-slug') || h.get('x-tenant-id'))
  } catch {
    return false
  }
}
