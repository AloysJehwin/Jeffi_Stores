import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@controller/lib/ecom/owner-api'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import { fetchService } from '@/lib/ecom/service-client'

export const dynamic = 'force-dynamic'

// Dashboard proxy: /api/ecom/svc/messaging/templates → messaging-service /templates (owner session, no API key).
async function handle(request: NextRequest, { params }: { params: Promise<{ service: string; path: string[] }> }) {
  const { service, path } = await params
  if (service !== 'messaging' && service !== 'documents') return NextResponse.json({ error: 'Unknown service' }, { status: 404 })
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  if (!hasService(ctx.tenant, service)) return NextResponse.json({ error: `${service} is not enabled for this workspace` }, { status: 403 })
  // Sends and renders wait for Jeffi's approval; browsing, templates and previews don't.
  if (request.method === 'POST' && (path[0] === 'messages' || path[0] === 'documents')) {
    const gate = blockedServices(await listServiceApprovals(ctx.tenant.id)).get(service)
    if (gate) return NextResponse.json({
      error: gate === 'rejected' ? 'service_rejected' : 'service_pending_approval',
      message: gate === 'rejected' ? `Your ${service} access was not approved. Contact support@jeffistores.in.` : `Your ${service} access is under review — sending starts once Jeffi approves it.`,
    }, { status: 403 })
  }
  const qs = request.nextUrl.search
  const body = (request.method === 'POST' || request.method === 'PUT') ? await request.json().catch(() => ({})) : undefined
  // Re-encode segments: slugs contain '/', which Next decodes in the catch-all.
  const res = await fetchService(service, ctx.tenant, '/' + path.map(encodeURIComponent).join('/') + qs, { method: request.method, body, space: 'api' })
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    // PDFs / images pass through as-is.
    const headers = new Headers({ 'content-type': type || 'application/octet-stream' })
    for (const h of ['content-disposition', 'cache-control']) { const v = res.headers.get(h); if (v) headers.set(h, v) }
    return new NextResponse(await res.arrayBuffer(), { status: res.status, headers })
  }
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status })
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE }
