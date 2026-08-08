import type { NextRequest } from 'next/server'
import type { SessionSignals } from './auth-sessions'

// Accepts a NextRequest (has typed .cookies) OR a plain Request (route handlers typed as
// `Request` — e.g. the admin MFA routes). We only ever read headers + the fp_hash cookie, so
// the plain-Request path reads fp_hash out of the raw Cookie header instead.
type SignalRequest = NextRequest | Request

function readFpHash(req: SignalRequest): string | null {
  // NextRequest path.
  const nextCookies = (req as NextRequest).cookies
  if (nextCookies && typeof nextCookies.get === 'function') {
    return nextCookies.get('fp_hash')?.value ?? null
  }
  // Plain Request path — parse the Cookie header.
  const raw = req.headers.get('cookie')
  if (!raw) return null
  const m = raw.match(/(?:^|;\s*)fp_hash=([^;]*)/)
  return m ? decodeURIComponent(m[1]) : null
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
    fpHash: readFpHash(req),
  }
}

