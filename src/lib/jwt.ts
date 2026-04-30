import { SignJWT, jwtVerify } from 'jose'
import { NextRequest } from 'next/server'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)
const JWT_EXPIRES_IN = '8h'

export interface JWTPayload {
  adminId: string
  username: string
  role: string
  scopes: string[]
  authCertCN?: string
  [key: string]: any
}

export interface UserJWTPayload {
  userId: string
  email: string
  [key: string]: any
}

export interface AdminJWTPayload {
  adminId: string
  username: string
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
    return { userId: payload.userId as string, email: payload.email as string }
  } catch {
    return null
  }
}

export async function authenticateAdmin(request: NextRequest): Promise<AdminJWTPayload | null> {
  const token = getTokenFromRequest(request, 'admin_token')
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    if (!payload.adminId || typeof payload.adminId !== 'string') return null
    return {
      adminId: payload.adminId as string,
      username: payload.username as string,
      role: payload.role as string,
      scopes: (payload.scopes as string[]) || [],
    }
  } catch {
    return null
  }
}
