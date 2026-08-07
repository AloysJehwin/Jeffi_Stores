import { SignJWT } from 'jose'
import { createSession } from './auth-sessions'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// Absolute TTL for customer + business sessions (was 30d; shortened to 7d).
export const USER_SESSION_TTL_S = 7 * 24 * 60 * 60

// Shared issuer for customer + business tokens. Creates a revocable session row and
// signs a JWT carrying its `sid`. Does NOT set cookies — callers keep their own cookie
// + cart-merge logic. `type` is 'customer' | 'business'; extraClaims carries business
// fields (isBusiness, approvalStatus).
export async function issueUserToken(args: {
  userId: string
  email: string
  type: 'customer' | 'business'
  extraClaims?: Record<string, unknown>
  userAgent?: string | null
  ip?: string | null
}): Promise<{ token: string; sid: string }> {
  const principalType = args.type === 'business' ? 'business' : 'customer'
  const { sid } = await createSession({
    principalType,
    principalId: args.userId,
    ttlSeconds: USER_SESSION_TTL_S,
    userAgent: args.userAgent,
    ip: args.ip,
  })

  const token = await new SignJWT({
    userId: args.userId,
    email: args.email,
    type: args.type,
    sid,
    ...(args.extraClaims || {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${USER_SESSION_TTL_S}s`)
    .sign(JWT_SECRET)

  return { token, sid }
}
