import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope, type AdminJWTPayload } from '@/lib/auth/jwt'
import { currentTenantPlanGate } from '@/lib/auth/plan-gate'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { IntegrationNotConnectedError } from '@/lib/integrations/resolve'
import { ChannelJobBusyError, errorText } from './sync-run'
import type { ChangeActor } from './types'

// Route helpers shared by the channel consoles: scope + plan gate for admin routes, the cron
// entry (secret, not-connected and busy handled), and readable errors.

/** Plan gate after the scope check: withPlan(await requireAdminScope(req, 'x:write'), 'x:write', 'X'). */
export async function withPlan(admin: AdminJWTPayload | NextResponse, scope: string, what: string): Promise<AdminJWTPayload | NextResponse> {
  if (admin instanceof NextResponse) return admin
  const gate = await currentTenantPlanGate(scope)
  if (!gate.allowed) {
    const plan = gate.upgradeRequired ?? 'pro'
    return NextResponse.json(
      { error: `${what} needs the ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan.`, upgradeRequired: plan },
      { status: 403 }
    )
  }
  return admin
}

export async function channelAdmin(request: NextRequest, scope: string, what: string): Promise<AdminJWTPayload | NextResponse> {
  return withPlan(await requireAdminScope(request, scope), scope, what)
}

export const actorOf = (admin: AdminJWTPayload): ChangeActor => ({ adminId: admin.adminId || null, email: admin.email ?? null })

export function channelError(e: unknown, notConnected = 'Connect the account first.'): NextResponse {
  if (e instanceof ChannelJobBusyError) return NextResponse.json({ error: e.message }, { status: 409 })
  if (e instanceof IntegrationNotConnectedError) return NextResponse.json({ error: notConnected }, { status: 409 })
  const status = Number((e as any)?.httpStatus ?? (e as any)?.status)
  if (status >= 400 && status < 500) return NextResponse.json({ error: errorText(e) }, { status: 400 })
  console.error('[channels] request failed', e)
  return NextResponse.json({ error: errorText(e) || 'Request failed' }, { status: status >= 500 ? 502 : 500 })
}

/** A cron job for the current store (the fan-out calls it per tenant). `ready` returns a skip
 * reason when the store has no connection or the platform is not configured. */
export async function channelCron(
  req: NextRequest,
  ready: () => Promise<string | null>,
  run: () => Promise<unknown>
): Promise<NextResponse> {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const skip = await ready()
    if (skip) return NextResponse.json({ skipped: skip })
  } catch {
    return NextResponse.json({ skipped: 'not_connected' })
  }
  try {
    return NextResponse.json(await run())
  } catch (e) {
    if (e instanceof ChannelJobBusyError) return NextResponse.json({ skipped: 'running' })
    if (e instanceof IntegrationNotConnectedError) return NextResponse.json({ skipped: 'not_connected' })
    return NextResponse.json({ error: errorText(e) }, { status: 500 })
  }
}

export async function readJson(request: NextRequest): Promise<any> {
  return request.json().catch(() => null)
}
