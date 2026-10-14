import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/auth/auth-sessions'
import { USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { consumeVaultTicket, STATE_COOKIE } from '@/lib/vault/sso'
import { VAULT_COOKIE } from '@/lib/vault/session'

// Vault host (/callback): burn the ticket, issue a host-only vault_sid, go to the bound target. The
// ECDSA device key is registered by the binding gate on the very next navigation (keys are minted
// in-browser, non-extractable).
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' }

export async function GET(request: NextRequest) {
  const ticket = await consumeVaultTicket(
    request.nextUrl.searchParams.get('t') || '',
    request.cookies.get(STATE_COOKIE)?.value
  )
  if (!ticket) {
    // No redirect back into the handoff: a persistently failing consume must not loop.
    return new NextResponse(
      '<!doctype html><meta name="robots" content="noindex"><title>Link expired</title>' +
        '<p>This sign-in link has expired or was already used. <a href="/library">Try again</a>.</p>',
      { status: 400, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const signals = extractSessionSignals(request)
  const { sid } = await createSession({
    principalType: 'vault',
    principalId: ticket.userId,
    ttlSeconds: USER_SESSION_TTL_S,
    role: ticket.principalType,
    tenantId: request.headers.get('x-tenant-id'),
    userAgent: signals.userAgent,
    ip: signals.ip,
    acceptLanguage: signals.acceptLanguage,
    uaPlatform: signals.uaPlatform,
    fpHash: signals.fpHash,
  })

  // Relative Location: the target is a validated vault path, and no Host header is trusted here.
  const res = new NextResponse(null, { status: 302, headers: { ...NO_STORE, Location: ticket.targetPath } })
  // Host-only (no Domain): never sent to the store or sibling hosts.
  res.cookies.set(VAULT_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: USER_SESSION_TTL_S,
  })
  res.cookies.delete(STATE_COOKIE)
  return res
}
