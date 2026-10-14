import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getTenant, hasService } from '@/lib/tenant-registry'
import { fetchService } from '@/lib/ecom/service-client'

export const dynamic = 'force-dynamic'

// Platform admin → messaging-service as this customer's Messaging API workspace (space 'api').
// internal: Jeffi's own edits skip the customer's restrictions and count as approved.
// /api/admin/ecom/* is platform-admin only (middleware).
async function handle(request: NextRequest, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, path } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!hasService(tenant, 'messaging')) return NextResponse.json({ error: 'Messaging is not enabled for this workspace' }, { status: 400 })
  const body = request.method === 'POST' || request.method === 'PUT' ? await request.json().catch(() => ({})) : undefined
  const res = await fetchService('messaging', { id: tenant.id, slug: tenant.slug }, '/' + path.map(encodeURIComponent).join('/') + request.nextUrl.search,
    { method: request.method, body, space: 'api', internal: true })
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) return new NextResponse(await res.arrayBuffer(), { status: res.status, headers: { 'content-type': type || 'application/octet-stream' } })
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status })
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE }
