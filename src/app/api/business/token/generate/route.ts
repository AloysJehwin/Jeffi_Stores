import { NextRequest, NextResponse } from 'next/server'
import { authenticateBusiness } from '@/lib/jwt'
import { SignJWT } from 'jose'

export const dynamic = 'force-dynamic'

const MAX_TTL = 86400 // 24 h
const DEFAULT_TTL = 3600 // 1 h

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// POST /api/business/token/generate
// Body: { ttl?: number (seconds) }
// Returns a short-lived JWT for Bearer auth on /api/business/* endpoints.
export async function POST(request: NextRequest) {
  const user = await authenticateBusiness(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ttl?: number } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const ttlSeconds = Math.min(MAX_TTL, Math.max(60, typeof body.ttl === 'number' ? body.ttl : DEFAULT_TTL))
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const token = await new SignJWT({
    userId: user.userId,
    email: user.email,
    type: 'business',
    isBusiness: true,
    approvalStatus: user.approvalStatus,
    scopes: user.scopes ?? [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(JWT_SECRET)

  return NextResponse.json({ token, expires_at: expiresAt.toISOString() })
}
