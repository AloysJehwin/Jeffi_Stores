import { NextRequest, NextResponse } from 'next/server'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { GoogleAdsApiError, GoogleAdsNotConfiguredError } from './client'
import { AdsMutationError, type ChangeActor } from './mutate'

// Campaign management is sold on Pro and up (google_ads_campaigns:write); reporting stays on
// google_ads:read (Growth and up). Session scopes are already narrowed to the tenant's plan; the
// plan gate here also turns a downgraded tenant away with the plan it needs. Routes call
// withCampaignPlan(await requireAdminScope(request, 'google_ads_campaigns:write')) so each one
// shows its write scope (tests/lib/admin-write-scope-audit.test.ts reads it).

export const MANAGE_SCOPE = 'google_ads_campaigns:write'

export async function withCampaignPlan(
  admin: AdminJWTPayload | NextResponse,
  what = 'Managing Google Ads campaigns'
): Promise<AdminJWTPayload | NextResponse> {
  if (admin instanceof NextResponse) return admin
  const gate = await currentTenantPlanGate(MANAGE_SCOPE)
  if (!gate.allowed) {
    const plan = gate.upgradeRequired ?? 'pro'
    return NextResponse.json(
      { error: `${what} needs the ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan.`, upgradeRequired: plan },
      { status: 403 }
    )
  }
  return admin
}

export const actorOf = (admin: AdminJWTPayload): ChangeActor => ({ adminId: admin.adminId || null, email: admin.email ?? null })

export function adsErrorResponse(e: unknown): NextResponse {
  if (e instanceof AdsMutationError) {
    return NextResponse.json(
      { error: e.message, stage: e.stage, problems: e.problems, requestId: e.requestId },
      { status: e.httpStatus >= 500 ? 502 : 400 }
    )
  }
  if (e instanceof GoogleAdsApiError) return NextResponse.json({ error: e.message, codes: e.codes }, { status: e.httpStatus >= 500 ? 502 : 400 })
  if (e instanceof GoogleAdsNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 503 })
  if (e instanceof IntegrationNotConnectedError) return NextResponse.json({ error: 'Connect a Google Ads account first.' }, { status: 409 })
  console.error('[google-ads] manage request failed', e)
  return NextResponse.json({ error: String((e as any)?.message ?? 'Request failed').slice(0, 300) }, { status: 500 })
}

export async function readJson(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => null)
}
