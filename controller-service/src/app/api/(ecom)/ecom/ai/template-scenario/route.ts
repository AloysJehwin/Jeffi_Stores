export const maxDuration = 180
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { ownerApi } from '@/lib/ecom/owner-api'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import { TemplateScenarioRequest } from '@/lib/ai/template-scenario.schema'
import { fillFromScenario, rateLimit, TemplateScenarioError } from '@/lib/ai/template-scenario'
import { AiWalletError } from '@/lib/ai/billing'
import { AiMediaError } from '@/lib/ai/media'

// POST /api/ecom/ai/template-scenario: owner-tenant twin of /api/admin/ai/template-scenario.
// Gated by an approved + unblocked Messaging or Documents service (same gate as /ecom/ai/enrich-field).
// isPlatformLibrary is forced to false — a store tenant always pays public pricing on its own wallet.
// Rate limited to one call per 10s per (tenant, scenario hash). Billing side effects are identical
// to the admin path with isPlatformLibrary=false (text via aiChat, image via generateImage).
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx

  const blocked = blockedServices(await listServiceApprovals(ctx.tenant.id))
  const ok = (['messaging', 'documents'] as const).some(s => hasService(ctx.tenant, s) && !blocked.has(s))
  if (!ok) {
    return NextResponse.json(
      { error: 'AI drafting is available once your Messaging or Documents access is approved' },
      { status: 403 }
    )
  }

  const parsed = TemplateScenarioRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid body' }, { status: 400 })
  }
  const body = parsed.data

  if (!rateLimit(ctx.tenant.id, body.scenarioText)) {
    return NextResponse.json({ error: 'please wait a few seconds before retrying this scenario' }, { status: 429 })
  }

  try {
    // Owner-tenant path: always store-owned, never a platform library. Billing lands on ctx.tenant.id
    // at public pricing — the same behaviour as the admin route with isPlatformLibrary=false.
    const fill = await fillFromScenario(body, ctx.tenant.id, false, ctx.owner.email ?? null)
    return NextResponse.json(fill)
  } catch (err) {
    if (err instanceof AiWalletError) {
      return NextResponse.json(
        { error: err.message, balanceInr: err.balanceInr, neededInr: err.neededInr },
        { status: err.status }
      )
    }
    if (err instanceof AiMediaError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof TemplateScenarioError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI service error' }, { status: 502 })
  }
}
