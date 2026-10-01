import type { NextRequest } from 'next/server'
import type { SessionSignals } from '@/lib/auth/auth-sessions'
import { BIND_COOKIE, PROOF_HEADER, normHost, type BindingContext } from '@/lib/auth/session-binding-shared'

// Accepts a NextRequest (has typed .cookies) OR a plain Request (route handlers typed as
// `Request` — e.g. the admin MFA routes). We only ever read headers + the fp_hash cookie, so
// the plain-Request path reads fp_hash out of the raw Cookie header instead.
type SignalRequest = NextRequest | Request

function readCookie(req: SignalRequest, name: string): string | null {
  // NextRequest path.
  const nextCookies = (req as NextRequest).cookies
  if (nextCookies && typeof nextCookies.get === 'function') {
    return nextCookies.get(name)?.value ?? null
  }
  // Plain Request path — parse the Cookie header.
  const raw = req.headers.get('cookie')
  if (!raw) return null
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function bindingContext(req: SignalRequest): BindingContext | undefined {
  try {
    return {
      host: normHost(req.headers.get('x-forwarded-host') ?? req.headers.get('host')),
      method: req.method,
      path: new URL(req.url).pathname,
      bindCookies: {
        customer: readCookie(req, BIND_COOKIE.customer),
        business: readCookie(req, BIND_COOKIE.business),
        admin: readCookie(req, BIND_COOKIE.admin),
        owner: readCookie(req, BIND_COOKIE.owner),
      },
      proof: req.headers.get(PROOF_HEADER),
      fetchDest: req.headers.get('sec-fetch-dest'),
    }
  } catch {
    return undefined
  }
}

// Single place that reads the per-request device-binding signals, so every login route
// (snapshot) and every enforcement caller (verify) collect the exact same set — no drift
// between what's stored and what's checked. All values are raw here; normalization
// (langPrimary/normPlatform/ipNetwork) happens inside auth-sessions.ts.
//
//   userAgent      — 'user-agent' header (UA family, STABLE)
//   acceptLanguage — 'accept-language' header (primary subtag, STABLE)
//   uaPlatform     — 'sec-ch-ua-platform' client hint (STABLE); requires the Accept-CH
//                    opt-in header set in middleware, and is absent on non-secure origins /
//                    unsupported browsers → null → dropped from scoring (fail open)
//   ip             — 'x-forwarded-for' (derived to a coarse network, SOFT/advisory)
//   fpHash         — 'fp_hash' cookie set client-side by the fingerprint beacon (SOFT/advisory,
//                    non-httpOnly by design; can only ever match or fail to match, never revoke alone)
export function extractSessionSignals(req: SignalRequest): SessionSignals {
  return {
    userAgent: req.headers.get('user-agent'),
    acceptLanguage: req.headers.get('accept-language'),
    uaPlatform: req.headers.get('sec-ch-ua-platform'),
    ip: req.headers.get('x-forwarded-for'),
    fpHash: readCookie(req, 'fp_hash'),
    binding: bindingContext(req),
  }
}

// For server components and actions, which have no Request object to hand over. Outside a request
// scope (scripts, cron, tests) next/headers throws and the caller falls back to no signals.
export async function ambientSessionSignals(): Promise<SessionSignals | undefined> {
  try {
    const { headers, cookies } = await import('next/headers')
    const h = await headers()
    const c = await cookies()
    const cookie = (name: string) => c.get(name)?.value ?? null
    return {
      userAgent: h.get('user-agent'),
      acceptLanguage: h.get('accept-language'),
      uaPlatform: h.get('sec-ch-ua-platform'),
      ip: h.get('x-forwarded-for'),
      fpHash: cookie('fp_hash'),
      binding: {
        host: normHost(h.get('x-forwarded-host') ?? h.get('host')),
        method: 'GET',
        path: '',
        bindCookies: {
          customer: cookie(BIND_COOKIE.customer),
          business: cookie(BIND_COOKIE.business),
          admin: cookie(BIND_COOKIE.admin),
          owner: cookie(BIND_COOKIE.owner),
        },
        proof: null,
        fetchDest: h.get('sec-fetch-dest'),
      },
    }
  } catch {
    return undefined
  }
}
