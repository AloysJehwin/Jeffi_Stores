import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ZodError } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

export interface OutreachAdmin {
  id: string
  label: string
}

/** Platform admin plus ecom_outreach:read (GET) or :write (mutations). Returns the admin, or the 401/403 response. */
export async function outreachGuard(req: NextRequest, mode: 'read' | 'write'): Promise<OutreachAdmin | NextResponse> {
  const admin = await requireAdminScope(req, `ecom_outreach:${mode}`)
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return { id: admin.adminId, label: `admin:${admin.adminId}` }
}

export const firstIssue = (e: ZodError): string => {
  const i = e.issues[0]
  return i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid request'
}

export const serverError = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : 'Internal server error' }, { status: 500 })
