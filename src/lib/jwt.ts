import { SignJWT, jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'
import { hasScope, getScopeForPath } from './scopes'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

// Single source of truth for session lifetime.
// JWT_EXPIRES_IN: jose format string used when signing the token.
// JWT_MAX_AGE_S:  cookie maxAge in seconds — must match JWT_EXPIRES_IN exactly.
export const JWT_EXPIRES_IN = '8h'
export const JWT_MAX_AGE_S = 8 * 60 * 60

export interface JWTPayload {
  adminId: string
  username: string
  first_name?: string
  last_name?: string
  role: string
  scopes: string[]
  authCertCN?: string
  [key: string]: any
}

export interface UserJWTPayload {
  userId: string
  email: string
  isBusiness?: boolean
  approvalStatus?: string
  scopes?: string[]
  [key: string]: any
}

export async function authenticateBusiness(request: NextRequest): Promise<UserJWTPayload | null> {
  const token = getTokenFromRequest(request, 'business_auth_token')
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (!payload.userId || typeof payload.userId !== 'string') return null
    if (!payload.isBusiness) return null
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      isBusiness: true,
      approvalStatus: payload.approvalStatus as string | undefined,
      scopes: (payload.scopes as string[] | undefined) ?? [],
    }
  } catch {
    return null
  }
}

export interface AdminJWTPayload {
  adminId: string
  username: string
  first_name?: string
  last_name?: string
  role: string
  scopes: string[]
  [key: string]: any
}

export async function generateToken(payload: JWTPayload): Promise<string> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET)

  return token
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as JWTPayload
  } catch {
    return null
  }
}

function getTokenFromRequest(request: NextRequest, cookieName: string): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7)
  }
  return request.cookies.get(cookieName)?.value || null
}

export async function authenticateUser(request: NextRequest): Promise<UserJWTPayload | null> {
  const token = getTokenFromRequest(request, 'auth_token')
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (!payload.userId || typeof payload.userId !== 'string') return null
    return { userId: payload.userId as string, email: payload.email as string, scopes: (payload.scopes as string[] | undefined) ?? [] }
  } catch {
    return null
  }
}

// Authenticates regular users OR business users (tries both cookies).
// Used by shared endpoints like support chat that serve both portals.
export async function authenticateAnyUser(request: NextRequest): Promise<UserJWTPayload | null> {
  return (await authenticateUser(request)) ?? (await authenticateBusiness(request))
}

export async function requireAdminScope(
  request: NextRequest,
  scope: string | null
): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (scope && !hasScope(admin.role, admin.scopes, scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

export async function authenticateAdmin(request: NextRequest): Promise<AdminJWTPayload | null> {
  const token = getTokenFromRequest(request, 'admin_token')
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (!payload.adminId || typeof payload.adminId !== 'string') return null
    const result = {
      adminId: payload.adminId as string,
      username: payload.username as string,
      first_name: payload.first_name as string | undefined,
      last_name: payload.last_name as string | undefined,
      role: payload.role as string,
      scopes: (payload.scopes as string[]) || [],
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const mod = await import('./audit-context')
        mod.setAuditAdminId(result.adminId)
      } catch {}
    }
    return result
  } catch {
    return null
  }
}

export async function requireUserScope(
  request: NextRequest,
  scope: string
): Promise<UserJWTPayload | NextResponse> {
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(user.scopes ?? []).includes(scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return user
}
