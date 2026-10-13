export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import { enrichField, parseEnrichBody } from '@/lib/ai/enrich-field'

// "Enrich with AI" for Messaging API customers in the ecom console (approved workspaces only).
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  if (!hasService(ctx.tenant, 'messaging')) return NextResponse.json({ error: 'Messaging is not enabled for this workspace' }, { status: 403 })
  if (blockedServices(await listServiceApprovals(ctx.tenant.id)).has('messaging'))
    return NextResponse.json({ error: 'AI writing is available once your Messaging access is approved' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    const result = await enrichField({ store: `${ctx.tenant.display_name} (a business using Jeffi's Messaging API)`, ...parseEnrichBody(body) })
    return NextResponse.json({ result })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'AI service error' }, { status: err?.status ?? 503 })
  }
}
