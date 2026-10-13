export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import { enrichField, parseEnrichBody } from '@/lib/ai/enrich-field'

// "Enrich with AI" in the ecom console: any workspace with an approved Messaging or Documents service.
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const blocked = blockedServices(await listServiceApprovals(ctx.tenant.id))
  const ok = (['messaging', 'documents'] as const).some(s => hasService(ctx.tenant, s) && !blocked.has(s))
  if (!ok) return NextResponse.json({ error: 'AI writing is available once your Messaging or Documents access is approved' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    const result = await enrichField({ store: `${ctx.tenant.display_name} (a business using Jeffi's Messaging API)`, ...parseEnrichBody(body) })
    return NextResponse.json({ result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'AI service error' }, { status: err?.status ?? 503 })
  }
}
