import { NextRequest, NextResponse } from 'next/server'
import { resolveSession, type PrincipalType } from '@/lib/auth-sessions'
import { queryOne } from '@/lib/db'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { adminCookieNameForHost } from '@/lib/admin-cookie'
import {
  BIND_COOKIE, BIND_ENDPOINT, BIND_TTL_S, PROOF_HEADER, bindingMode, normHost, parsePublicJwk,
  verifyProof, loadSessionKey, registerSessionKey, consumeRefresh, mintBindCookie, logBinding,
  sidHashOf, canRegisterKey,
} from '@/lib/session-binding'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/auth/rt — for every session cookie on this request: register the browser's key the
// first time it is seen, then (always) exchange a fresh signed proof for the short-lived cookie.
export async function POST(request: NextRequest) {
  const now = Date.now()
  if (bindingMode() === 'off') return NextResponse.json({ ok: true, now, exp: null, bound: 0, types: [] })

  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const host = normHost(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  const candidates: [PrincipalType, string | undefined][] = [
    ['customer', request.cookies.get('user_sid')?.value],
    ['business', request.cookies.get('business_sid')?.value],
    ['owner', request.cookies.get('owner_sid')?.value],
    ['admin', request.cookies.get(adminCookieNameForHost(host))?.value],
  ]
  const present = candidates.filter((c): c is [PrincipalType, string] => !!c[1])
  if (present.length === 0) return NextResponse.json({ ok: true, now, exp: null, bound: 0, types: [] })

  const body = await request.json().catch(() => ({}))
  const offeredKey = parsePublicJwk(body?.k)
  const proof = request.headers.get(PROOF_HEADER)
  const { binding: _omit, ...signals } = extractSessionSignals(request)

  const minted: { name: string; value: string }[] = []
  const types: PrincipalType[] = []
  let bound = 0
  let exp: number | null = null
  let staleClock = false

  for (const [type, sid] of present) {
    const sess = await resolveSession(sid, signals).catch(() => null)
    if (!sess || sess.principalType !== type) continue

    const sidHash = sidHashOf(sid)
    const row = await queryOne<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM auth_sessions WHERE ${UUID_RE.test(sid) ? 'id' : 'token_hash'} = $1`,
      [sidHash]
    )
    if (!row) continue
    const sessionId = row.id

    let key = await loadSessionKey(sessionId)
    if (key === 'unavailable') continue
    if (!key) {
      // Registration is only accepted with a proof made by the key being registered.
      if (!offeredKey) continue
      if (!canRegisterKey(new Date(row.created_at).getTime())) {
        logBinding({ sessionId, principalType: type, reason: 'registration_closed', path: BIND_ENDPOINT, host })
        continue
      }
      if (!verifyProof(offeredKey, proof, 'POST', BIND_ENDPOINT).ok) { staleClock = true; continue }
      key = await registerSessionKey(sessionId, offeredKey, host)
      if (!key) continue
    }

    const checked = verifyProof(key.jwk, proof, 'POST', BIND_ENDPOINT)
    if (!checked.ok) {
      logBinding({ sessionId, principalType: type, reason: 'refresh_invalid', path: BIND_ENDPOINT, host })
      staleClock = true
      continue
    }
    if (key.host !== host) {
      logBinding({ sessionId, principalType: type, reason: 'host_mismatch', path: BIND_ENDPOINT, host, boundHost: key.host })
      continue
    }
    if (!(await consumeRefresh(sessionId, checked.ts))) {
      logBinding({ sessionId, principalType: type, reason: 'refresh_replayed', path: BIND_ENDPOINT, host })
      continue
    }

    const cookie = mintBindCookie(sidHash, host)
    minted.push({ name: BIND_COOKIE[type], value: cookie.value })
    types.push(type)
    bound++
    exp = exp === null ? cookie.exp * 1000 : Math.min(exp, cookie.exp * 1000)
  }

  // Nothing bound although sessions were present: most often the client clock is off by more
  // than the proof window. Returning server time lets it correct itself and retry once.
  const res = NextResponse.json(
    { ok: bound > 0 || !staleClock, now, exp, bound, types },
    { status: bound === 0 && staleClock ? 409 : 200 }
  )
  // Host-only on purpose (no Domain): the key lives in one origin, so the cookie it earns must too.
  // Lax, not strict: arriving from an emailed link must still present it, or every such visit
  // would detour through the re-bind step.
  for (const c of minted) {
    res.cookies.set(c.name, c.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: BIND_TTL_S,
      path: '/',
    })
  }
  return res
}
