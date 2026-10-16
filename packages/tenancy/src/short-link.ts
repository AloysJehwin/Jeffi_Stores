import { createHmac, timingSafeEqual } from 'node:crypto'

// Self-contained button links: `<base64url destination>.<signature>`. The redirect host (img.<domain>)
// verifies them without a DB row, so a link stays valid whichever environment's DB the sender wrote to.
const SIG_LEN = 16
const MAX_TOKEN = 1500
const secret = () => process.env.SHORT_LINK_SECRET || ''
const sig = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, SIG_LEN)

/** A signed token for the destination, or null when signing is off or the link would be too long. */
export function signLink(destination: string): { token: string; id: string } | null {
  if (!secret()) return null
  const payload = Buffer.from(destination).toString('base64url')
  const id = sig(payload)
  const token = `${payload}.${id}`
  return token.length > MAX_TOKEN ? null : { token, id }
}

/** The destination of a valid signed token (http/https only), else null. */
export function verifyLink(token: string): { destination: string; id: string } | null {
  const dot = token.lastIndexOf('.')
  if (!secret() || dot < 1) return null
  const payload = token.slice(0, dot), given = Buffer.from(token.slice(dot + 1)), want = Buffer.from(sig(payload))
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  const destination = Buffer.from(payload, 'base64url').toString()
  return /^https?:\/\//i.test(destination) ? { destination, id: want.toString() } : null
}
