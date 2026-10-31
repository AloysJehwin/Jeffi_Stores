import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { actorOf, channelError, readJson, withPlan } from '@/lib/channels/route'
import { ActionSchema, isSettingsAction, runMerchantAction } from '@/lib/merchant/actions'

export const dynamic = 'force-dynamic'

/** One change from the console; `preview: true` validates and shows the before/after only. */
export async function POST(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'merchant_sync:write'), 'merchant_sync:write', 'Google Merchant')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  if (isSettingsAction(parsed.data) && !hasScope(admin.role, admin.scopes, 'merchant_sync:settings_write')) {
    return NextResponse.json({ error: 'Changing Merchant Center settings needs the Merchant Center Settings permission.' }, { status: 403 })
  }
  try {
    const out = await runMerchantAction(parsed.data, actorOf(admin), body?.preview === true)
    return NextResponse.json(out, { status: out.ok || out.preview ? 200 : 400 })
  } catch (e) {
    return channelError(e, 'Connect Google Merchant Center first.')
  }
}
