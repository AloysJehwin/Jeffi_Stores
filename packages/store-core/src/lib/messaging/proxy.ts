import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { authenticateAdmin, authenticateAnyUser } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')

function token(claims: Record<string, unknown>) {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'platform', internal: true, ...claims, exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

const PLATFORM_TENANT = { tenantId: FLAGSHIP_TENANT_ID, slug: 'platform' }

async function forward(request: NextRequest, path: string, claims: Record<string, unknown>, allowPlatform = false): Promise<NextResponse> {
  // Platform admin host has no tenant: it curates the platform defaults (templates library).
  const tenant = (await resolveTenant()) ?? (allowPlatform ? PLATFORM_TENANT : null)
  if (!tenant) return NextResponse.json({ error: 'Messaging is only available on a tenant host' }, { status: 501 })
  const url = new URL(request.url)
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text()
  const res = await fetch(`${MESSAGING_URL}${path}${url.search}`, {
    method: request.method,
    headers: {
      authorization: `Bearer ${token({ tenantId: tenant.tenantId, tenantSlug: tenant.slug, ...claims })}`,
      ...(body ? { 'content-type': request.headers.get('content-type') || 'application/json' } : {}),
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

export async function proxyAdminMessaging(request: NextRequest, path: string, scope: string): Promise<NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, scope)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return forward(request, path, { adminId: admin.adminId, role: admin.role, scopes: admin.scopes }, true)
}

export async function proxyUserMessaging(request: NextRequest, path: string): Promise<NextResponse> {
  const user = await authenticateAnyUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return forward(request, path, { userId: user.userId })
}
