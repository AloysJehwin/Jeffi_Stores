# ADR-0006: JWT-based stateless auth with per-portal token types

- **Status**: Accepted
- **Date**: 2026-06-18
- **Authors**: engineering

## Context

Three portals, three user populations, three auth flows:

- Visitors authenticate via OTP (email or phone). Sessions are short-lived and resumable — a customer closing their browser should not be forced to re-authenticate on the next visit.
- Business accounts authenticate with email + password. They may stay logged in across working days.
- Admins authenticate with email + password + TOTP MFA. Admin sessions should expire on inactivity.

The alternatives considered were:

1. **NextAuth / Auth.js** — a Next.js-native session library. Would handle much of the plumbing but adds a server-side session store requirement (database adapter) and an abstraction layer over JWTs that makes custom payload fields and per-portal discrimination harder to control.
2. **Cookie-based server sessions** — session ID in cookie, session data in Redis or DB. Simple mental model but requires a session store, a cleanup job, and a Redis tier that is not otherwise needed (see ADR-0005).
3. **Stateless JWTs** — all session state encoded in the token; server is stateless. No session store. Revocation is handled by short TTL + refresh.

The stateless JWT approach was chosen because it eliminates the session-store dependency entirely and maps cleanly onto the per-portal isolation requirement: the `type` field in the payload is the authoritative portal discriminator read by middleware.

The `jsonwebtoken` npm package was evaluated and rejected. It uses the legacy `crypto` module callback API and does not expose a Promise-based interface suitable for Next.js edge/serverless contexts. The `jose` library (RFC 7515/7517/7518 compliant) provides a clean async API, supports the Web Crypto API natively, and runs correctly in the Next.js edge runtime.

## Decision

Use `jose` for all JWT signing and verification. Issue three distinct token types:

| Token type | `payload.type` | `payload.role` | TTL | Storage |
|------------|---------------|----------------|-----|---------|
| Customer | `customer` | — | 7 days | httpOnly cookie (`token`) |
| Business | `business` | — | 24 h | httpOnly cookie (`business_token`) |
| Admin | `admin` | `super_admin` / `admin` / `staff` | 8 h | httpOnly cookie (`admin_token`) |

All cookies are `httpOnly`, `sameSite: lax`, and `secure` in production. Tokens are signed with `HS256` using a per-portal secret from environment variables (`JWT_SECRET`, `BUSINESS_JWT_SECRET`, `ADMIN_JWT_SECRET`). Per-portal secrets mean a leaked customer token cannot be replayed against admin routes even if verification code is misconfigured.

Middleware reads the relevant cookie for the current route group, verifies the token, and checks `payload.type` matches the portal. API routes re-verify independently — middleware verification is not trusted as sufficient for mutation endpoints.

Token revocation before TTL expiry is not implemented. Admin forced-logout is handled by rotating `ADMIN_JWT_SECRET` (invalidates all admin sessions simultaneously). Per-user revocation is a future feature gated on adding a token blocklist table.

## Consequences

**Positive**

- No session store. Scales horizontally without sticky sessions or shared state.
- Per-portal secrets provide defense-in-depth: portal isolation is enforced cryptographically, not only by application logic.
- `jose` runs in the Next.js edge runtime and serverless functions without polyfills.
- Middleware token checks are cheap — no DB round-trip to validate a session.

**Negative**

- Token revocation before TTL is not granular. Rotating the secret logs out all users of that portal, not just one compromised account.
- 8-hour admin TTL means an admin who forgets to log out stays logged in for up to 8 hours. Shorter TTL requires a refresh-token flow (not yet implemented).
- Three separate secrets to rotate and manage in the environment. A missing secret causes a silent 500 rather than a startup failure (audit item: add startup guard).
- `jsonwebtoken` package is still present as a transitive dependency (audit item #17: remove it to reduce attack surface).
