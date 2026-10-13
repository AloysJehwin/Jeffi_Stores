import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService } from '@/lib/tenant-registry'
import { callService } from '@/lib/ecom/service-client'

export const dynamic = 'force-dynamic'

// Dashboard proxy: /api/ecom/svc/messaging/templates → messaging-service /templates (owner session, no API key).
async function handle(request: NextRequest, { params }: { params: Promise<{ service: string; path: string[] }> }) {
  const { service, path } = await params
  if (service !== 'messaging' && service !== 'documents') return NextResponse.json({ error: 'Unknown service' }, { status: 404 })
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  if (!hasService(ctx.tenant, service)) return NextResponse.json({ error: `${service} is not enabled for this workspace` }, { status: 403 })
  const qs = request.nextUrl.search
  const body = (request.method === 'POST' || request.method === 'PUT') ? await request.json().catch(() => ({})) : undefined
  // Re-encode segments: slugs contain '/', which Next decodes in the catch-all.
  const r = await callService(service, ctx.tenant, '/' + path.map(encodeURIComponent).join('/') + qs, { method: request.method, body })
  return NextResponse.json(r.body, { status: r.status })
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE }
