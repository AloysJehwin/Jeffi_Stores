import { hasScope } from '@/lib/scopes'

// Domain scopes an AI action may be gated on. The client sends the scope of the field it is
// changing; only these are honoured, so a caller cannot widen access by naming an arbitrary scope.
export const AI_ACTION_SCOPES = [
  'products:write',
  'categories:write',
  'brands:write',
  'coupons:write',
  'reviews:write',
  'review_forms:write',
  'mailer:write',
  'campaigns:write',
  'crm:write',
  'customers:write',
  'settings:write',
] as const

export type AiActionScope = typeof AI_ACTION_SCOPES[number]

/** Returns the scope to check, or null when the requested one is not an allowed AI scope. */
export function resolveAiScope(requested: unknown, fallback: AiActionScope = 'products:write'): AiActionScope | null {
  if (requested === undefined || requested === null || requested === '') return fallback
  return (AI_ACTION_SCOPES as readonly string[]).includes(String(requested))
    ? (String(requested) as AiActionScope)
    : null
}

/** Admin AI tools are sold under this plan feature (Pro, Enterprise). Session scopes are
 * plan-narrowed, so holding it means the plan includes AI and the admin's role may use it. */
export const AI_ADMIN_SCOPE = 'catalog_enrichment:write'

/** Why an admin may not run an AI action on `fieldScope`, or null when allowed. Routes return it as a 403. */
export function aiDenial(role: string, scopes: string[], fieldScope: string): string | null {
  if (!hasScope(role, scopes, AI_ADMIN_SCOPE)) return 'AI tools are not available for your plan or role'
  if (!hasScope(role, scopes, fieldScope)) return 'Insufficient permissions'
  return null
}

export function canUseAi(role: string, scopes: string[], fieldScope: string): boolean {
  return aiDenial(role, scopes, fieldScope) === null
}

/** Customer-facing AI features on the storefront are sold per plan under this scope. */
export const AI_STOREFRONT_SCOPE = 'ai:storefront'

/** Parse a model's JSON reply, tolerating prose around the object. */
export function parseAiJson<T = Record<string, unknown>>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { return JSON.parse(m[0]) as T } catch { return null }
  }
}
