import type { NextRequest } from 'next/server'
import { resolveSession, type ResolvedSession, type SessionSignals } from '@/lib/auth/auth-sessions'
import { extractSessionSignals, ambientSessionSignals } from '@/lib/auth/session-signals-request'
import { resolveRequestTenantId } from '@/lib/tenancy/request-tenant'

// Host-only vault_sid session (principal 'vault'), minted by the SSO callback. `role` snapshots how
// the buyer signed in on the store (customer|business). Callers run inside the tenant context.

export const VAULT_COOKIE = 'vault_sid'

export interface VaultSession {
  userId: string
  tenantId: string | null
  principalType: 'customer' | 'business'
  email: string | null
  displayName: string | null
  sessionId: string
  sid: string
}

function toVaultSession(s: ResolvedSession | null): VaultSession | null {
  if (!s || s.principalType !== 'vault') return null
  return {
    userId: s.principalId,
    tenantId: s.tenantId,
    principalType: s.role === 'business' ? 'business' : 'customer',
    email: s.email,
    displayName: s.displayName,
    sessionId: s.sessionId,
    sid: s.sid,
  }
}

/** Mirrors the middleware cross-tenant guard: the session must belong to exactly this tenant. */
export function sessionMatchesTenant(session: Pick<VaultSession, 'tenantId'>, tenantId: string | null): boolean {
  return (session.tenantId ?? null) === (tenantId ?? null)
}

export async function resolveVaultSid(
  sid: string | undefined,
  signals: SessionSignals | null | undefined
): Promise<VaultSession | null> {
  if (!sid) return null
  return toVaultSession(await resolveSession(sid, signals ?? undefined))
}

/** Server components: reads vault_sid via next/headers and asserts the request tenant. */
export async function getVaultSession(): Promise<VaultSession | null> {
  const { cookies } = await import('next/headers')
  const sid = (await cookies()).get(VAULT_COOKIE)?.value
  const s = await resolveVaultSid(sid, await ambientSessionSignals())
  return s && sessionMatchesTenant(s, await resolveRequestTenantId()) ? s : null
}

/** Route handlers: resolves vault_sid from the request and asserts the request tenant. */
export async function resolveVaultSession(request: NextRequest): Promise<VaultSession | null> {
  const s = await resolveVaultSid(request.cookies.get(VAULT_COOKIE)?.value, extractSessionSignals(request))
  return s && sessionMatchesTenant(s, request.headers.get('x-tenant-id')) ? s : null
}
