import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import type { DriveActor } from './access'
import { DriveError } from './files'

export async function driveActor(request: NextRequest, scope: 'drive:read' | 'drive:write'): Promise<DriveActor | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return { adminId: admin.adminId, role: admin.role, scopes: admin.scopes ?? [] }
}

export const reqMeta = (request: NextRequest) => ({ ip: request.headers.get('x-forwarded-for'), userAgent: request.headers.get('user-agent') })

export function driveFailure(err: unknown, what: string): NextResponse {
  if (err instanceof DriveError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[drive] ${what}`, err)
  return NextResponse.json({ error: `${what} failed` }, { status: 500 })
}

export const denied = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
