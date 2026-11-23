// @vitest-environment node
//
// Seed/session/request helpers for DB-backed API tests. All take the dynamically-imported db module so
// they run against the single jeffi_test pool the test already pinned via requireTestDb().

// A faithful customer session: calls the REAL createSession (stores SHA-256(token), returns the raw token
// to use as Bearer / user_sid cookie). Exercises resolveSession against jeffi_test.
export async function makeCustomerSession(
  auth: typeof import('@/lib/auth/auth-sessions'),
  principalId: string
): Promise<{ sid: string; id: string }> {
  const { sid, id } = await auth.createSession({
    principalType: 'customer',
    principalId,
    ttlSeconds: 3600,
  })
  return { sid, id }
}

export async function makeAdminSession(
  auth: typeof import('@/lib/auth/auth-sessions'),
  adminPrincipalId: string,
  scopes: string[] = ['*'],
  role = 'administrator'
): Promise<{ sid: string; id: string }> {
  const { sid, id } = await auth.createSession({
    principalType: 'admin',
    principalId: adminPrincipalId,
    ttlSeconds: 3600,
    role,
    scopes,
  })
  return { sid, id }
}

// A store-owner session (ecom control-plane routes gated by ownerApi → resolveOwnerSession).
// Calls the real issueOwnerSession (upserts owners row + auth_sessions principal_type='owner').
// Returns the cookie sid; pass it via apiRequest's `cookies: { owner_sid: sid }`.
export async function makeOwnerSession(
  ownerSession: typeof import('@/lib/auth/owner-session'),
  email: string,
  name = 'API Test Owner'
): Promise<{ sid: string; owner: { id: string } }> {
  const { sid, owner } = await ownerSession.issueOwnerSession({ email, name })
  return { sid, owner }
}

// Build a NextRequest with a Bearer session token (the opaque sid) + optional JSON body.
// NextRequest (not plain Request) so handlers that read req.cookies / req.nextUrl work.
export async function apiRequest(
  method: string,
  url: string,
  opts: { sid?: string; body?: unknown; headers?: Record<string, string>; cookies?: Record<string, string> } = {}
): Promise<import('next/server').NextRequest> {
  const { NextRequest } = await import('next/server')
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.sid) headers['Authorization'] = `Bearer ${opts.sid}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.cookies) {
    headers['cookie'] = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }
  return new NextRequest(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

// Delete rows by id in the given tables (FK-safe order is the caller's responsibility).
// Swallows per-statement errors so afterAll cleanup never masks a test failure.
export async function cleanupRows(
  db: typeof import('@/lib/shared/db'),
  deletes: Array<{ table: string; ids: string[] }>
): Promise<void> {
  for (const { table, ids } of deletes) {
    if (!ids.length) continue
    await db
      .query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])
      .catch(() => {})
  }
}

// End the lazily-built default pool so the test process exits cleanly.
export async function endPool(): Promise<void> {
  await (globalThis as any).__appPool?.end?.().catch(() => {})
}
