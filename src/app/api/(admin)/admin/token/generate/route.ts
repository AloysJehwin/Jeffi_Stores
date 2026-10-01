import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { SignJWT } from 'jose'

export const dynamic = 'force-dynamic'

const MAX_TTL = 86400 // 24 h
const DEFAULT_TTL = 3600 // 1 h

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// POST /api/admin/token/generate
// Body: { scopes?: string[], ttl?: number (seconds) }
// Returns a short-lived JWT for Bearer auth on /api/admin/* endpoints.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scopes?: string[]; ttl?: number } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const ttlSeconds = Math.min(MAX_TTL, Math.max(60, typeof body.ttl === 'number' ? body.ttl : DEFAULT_TTL))

  // Requested scopes must be a subset of the admin's own scopes
  const requestedScopes: string[] = Array.isArray(body.scopes) ? body.scopes : admin.scopes
  const validScopes = requestedScopes.filter(s => hasScope(admin.role, admin.scopes, s))

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const token = await new SignJWT({
    type: 'extension_token',
    adminId: admin.adminId,
    first_name: admin.first_name,
    last_name: admin.last_name,
    email: admin.email,
    role: admin.role,
    scopes: validScopes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(JWT_SECRET)

  return NextResponse.json({ token, expires_at: expiresAt.toISOString(), scopes: validScopes })
}
