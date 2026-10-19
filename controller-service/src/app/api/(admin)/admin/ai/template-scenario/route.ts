export const maxDuration = 180
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { requireAdminScope } from '@/lib/auth/jwt'
import { aiDenial, AI_ADMIN_SCOPE } from '@/lib/auth/ai-scope'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { TemplateScenarioRequest } from '@/lib/ai/template-scenario.schema'
import { fillFromScenario, rateLimit, TemplateScenarioError } from '@/lib/ai/template-scenario'
import { AiWalletError } from '@/lib/ai/billing'
import { AiMediaError } from '@/lib/ai/media'

// POST /api/admin/ai/template-scenario: scenario text → filled template (body, placeholders, buttons,
// optional header image). Guarded by templates:write + the AI plan scope; rate-limited to one call per
// 10s per (admin, scenario hash) to stop accidental double-fires from the editor's "Fill from scenario"
// dialog. Billing is split: text charge via aiChat (feature='template_scenario_fill'), image charge
// via generateImage (feature='template_scenario_image'). credentialOwnerId() routes the charge to the
// caller tenant for store templates and to the platform (free) for library templates.
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'templates:write')
  if (admin instanceof NextResponse) return admin
  const denied = aiDenial(admin.role, admin.scopes, 'templates:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  const plan = await currentTenantPlanGate(AI_ADMIN_SCOPE)
  if (!plan.allowed) return NextResponse.json({ error: 'AI tools are not available for your plan' }, { status: 403 })

  const parsed = TemplateScenarioRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid body' }, { status: 400 })
  }
  const body = parsed.data

  if (!rateLimit(admin.adminId, body.scenarioText)) {
    return NextResponse.json({ error: 'please wait a few seconds before retrying this scenario' }, { status: 429 })
  }

  const tenantId = await resolveTenantId()

  try {
    const fill = await fillFromScenario(body, tenantId, body.isPlatformLibrary, admin.email ?? null)
    return NextResponse.json(fill)
  } catch (err) {
    if (err instanceof AiWalletError) {
      return NextResponse.json({ error: err.message, balanceInr: err.balanceInr, neededInr: err.neededInr }, { status: err.status })
    }
    if (err instanceof AiMediaError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof TemplateScenarioError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI service error' }, { status: 502 })
  }
}
