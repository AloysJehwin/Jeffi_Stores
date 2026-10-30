import 'server-only'
import { createSession, effectiveScopes, revokeSession } from '@/lib/auth/auth-sessions'
import { queryOne } from '@/lib/shared/db'
import type { AgentActor } from '@/lib/admin-agent/permissions'

// The admin assistant off the panel (WhatsApp) acts as the admin: same role, the same plan-narrowed
// scopes a session of theirs gets, and a short-lived session for the admin API calls an approval makes.

export const AGENT_USER_AGENT = 'JeffiAdminAgent/1 (whatsapp)'
const SESSION_TTL_S = 300

export interface AdminActor extends AgentActor {
  granted: string[]
  mobile: string | null
}

/** An active admin of the current store, or null. */
export async function loadAdminActor(adminId: string, tenantId: string | null): Promise<AdminActor | null> {
  const a = await queryOne<{ role: string; scopes: string[] | null; mobile: string | null }>(
    `SELECT role, scopes, CASE WHEN mobile_verified_at IS NOT NULL THEN mobile END AS mobile
       FROM admins WHERE id = $1::uuid AND is_active = TRUE`,
    [adminId]
  )
  if (!a) return null
  const granted = Array.isArray(a.scopes) ? a.scopes : []
  return { adminId, role: a.role, granted, scopes: await effectiveScopes(tenantId, granted, a.role), mobile: a.mobile }
}

/** Runs fn with a 5-minute session for the admin in this store; it is revoked when fn returns. */
export async function withInternalAdminSession<T>(
  admin: AdminActor,
  tenantId: string | null,
  fn: (cookieHeader: string) => Promise<T>
): Promise<T> {
  const { sid } = await createSession({
    principalType: 'admin',
    principalId: admin.adminId,
    ttlSeconds: SESSION_TTL_S,
    role: admin.role,
    scopes: admin.granted,
    tenantId,
    userAgent: AGENT_USER_AGENT,
  })
  try {
    return await fn(`admin_sid=${sid}`)
  } finally {
    await revokeSession(sid).catch(() => {})
  }
}
