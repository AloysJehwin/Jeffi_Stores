import crypto from 'crypto'

// Shared guard for the internal cron/service endpoints authenticated by a bearer CRON_SECRET.
// Returns true only when CRON_SECRET is set and the Authorization header matches it, compared in
// constant time so a mismatched secret cannot be probed by timing. A missing secret returns false
// (the same as a mismatch) so every existing 401-on-missing-or-wrong caller keeps its behaviour;
// callers that need a distinct 503 for an unconfigured secret check process.env.CRON_SECRET first.

interface HeaderBag {
  get(name: string): string | null
}

export function verifyCronRequest(req: { headers: HeaderBag }): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const expected = `Bearer ${secret}`
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
