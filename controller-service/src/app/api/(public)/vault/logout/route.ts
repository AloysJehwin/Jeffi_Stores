import { NextRequest, NextResponse } from 'next/server'
import { revokeSession } from '@/lib/auth/auth-sessions'
import { VAULT_COOKIE } from '@/lib/vault/session'
import { storeBaseUrlAsync } from '@/lib/vault/links'

// Vault host: end this browser's vault session only (the store session stays signed in).
// JSON, not a redirect: CSP form-action/connect-src would block a cross-host redirect hop.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const sid = request.cookies.get(VAULT_COOKIE)?.value
  // Holding the cookie is the authority to end it, whatever its tenant or state.
  if (sid) await revokeSession(sid).catch(() => {})
  const res = NextResponse.json(
    { ok: true, redirect: await storeBaseUrlAsync().catch(() => '/') },
    { headers: { 'Cache-Control': 'no-store' } }
  )
  res.cookies.set(VAULT_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
