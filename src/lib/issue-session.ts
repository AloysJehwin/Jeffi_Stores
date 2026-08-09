import { createSession } from './auth-sessions'

// Absolute TTL for customer + business sessions (was 30d; shortened to 7d).
export const USER_SESSION_TTL_S = 7 * 24 * 60 * 60

// Shared issuer for customer + business sessions. Creates the opaque server-side session
// and returns its id (the cookie value) — NO JWT. Callers set cookie = sid and keep their
// own cart-merge logic. `type` is 'customer' | 'business'; extraClaims carries business
// fields (isBusiness, approvalStatus — the latter snapshotted onto the session row).
export async function issueUserToken(args: {
  userId: string
  email: string
  type: 'customer' | 'business'
  extraClaims?: Record<string, unknown>
  userAgent?: string | null
  ip?: string | null
  acceptLanguage?: string | null
  uaPlatform?: string | null
  fpHash?: string | null
}): Promise<{ sid: string }> {
  const principalType = args.type === 'business' ? 'business' : 'customer'
  const approvalStatus = args.extraClaims?.approvalStatus
  const { sid } = await createSession({
    principalType,
    principalId: args.userId,
    ttlSeconds: USER_SESSION_TTL_S,
    userAgent: args.userAgent,
    ip: args.ip,
    approvalStatus: typeof approvalStatus === 'string' ? approvalStatus : null,
    acceptLanguage: args.acceptLanguage,
    uaPlatform: args.uaPlatform,
    fpHash: args.fpHash,
  })
  return { sid }
}
