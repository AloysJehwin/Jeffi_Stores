import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { authenticateAdmin, authenticateAnyUser } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'

// Invoice / quotation / purchase-order APIs live in document-service. These Next routes keep their
// URLs (same-origin cookie auth), authenticate here, then forward with the admin's identity in the
// service token. Response status/headers/body are streamed back as-is.
const DOCUMENTS_URL = (process.env.DOCUMENTS_URL || 'http://localhost:3102').replace(/\/$/, '')

function token(claims: Record<string, unknown>) {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', internal: true, ...claims, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

async function forward(request: NextRequest, path: string, claims: Record<string, unknown>): Promise<NextResponse> {
  const tenant = await resolveTenant()
  if (!tenant) return NextResponse.json({ error: 'Documents service is only available on a tenant host' }, { status: 501 })
  const url = new URL(request.url)
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()
  const res = await fetch(`${DOCUMENTS_URL}${path}${url.search}`, {
    method: request.method,
    headers: {
      authorization: `Bearer ${token({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, ...claims })}`,
      'content-type': request.headers.get('content-type') || 'application/json',
    },
    body: body || undefined,
    cache: 'no-store',
    redirect: 'manual',
  })
  const headers = new Headers()
  for (const k of ['content-type', 'content-disposition', 'content-length', 'location']) {
    const v = res.headers.get(k)
    if (v) headers.set(k, v)
  }
  return new NextResponse(res.body, { status: res.status, headers })
}

/** Admin-authenticated proxy. `scope` mirrors what the handler used to check itself. */
export async function proxyAdminDocs(request: NextRequest, path: string, scope: string): Promise<NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return forward(request, path, { adminId: admin.adminId, role: admin.role, scopes: admin.scopes })
}

/** Customer-or-admin proxy (the order invoice download). */
export async function proxyUserOrAdminDocs(request: NextRequest, path: string): Promise<NextResponse> {
  const admin = await authenticateAdmin(request)
  if (admin) return forward(request, path, { adminId: admin.adminId, role: admin.role, scopes: admin.scopes })
  const user = await authenticateAnyUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return forward(request, path, { userId: user.userId })
}
