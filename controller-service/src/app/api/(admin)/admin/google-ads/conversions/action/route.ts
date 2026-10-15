import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { googleAdsClientFor } from '@/lib/google-ads/credentials'
import { GoogleAdsApiError } from '@/lib/google-ads/client'
import {
  ConversionActionError,
  chooseConversionAction,
  clearConversionAction,
  createServerConversionAction,
} from '@/lib/google-ads/conversions/actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create'), primary: z.boolean().optional() }),
  z.object({ mode: z.literal('select'), resourceName: z.string().trim().min(1) }),
])

// Choose where server-side purchases are uploaded: create / reuse "Purchase (server)", or pick an
// existing import action. DELETE stops uploads (the queue keeps filling and resumes once one is set).
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 })
  let ads
  try {
    // A create is not idempotent, so no automatic retries.
    ads = await googleAdsClientFor(undefined, { retryDelays: [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Google Ads is not connected' }, { status: 409 })
  }
  try {
    const body = parsed.data
    if (body.mode === 'create') {
      const { action, created } = await createServerConversionAction(ads, { primary: !!body.primary })
      await audit(request, admin.adminId, `${created ? 'Created' : 'Chose'} Google Ads conversion action "${action.name}" for server-side purchases`)
      return NextResponse.json({ ok: true, created, action })
    }
    const action = await chooseConversionAction(ads, body.resourceName)
    await audit(request, admin.adminId, `Chose Google Ads conversion action "${action.name}" for server-side purchases`)
    return NextResponse.json({ ok: true, created: false, action })
  } catch (e) {
    if (e instanceof ConversionActionError) return NextResponse.json({ error: e.message }, { status: 400 })
    const status = e instanceof GoogleAdsApiError ? 502 : 500
    return NextResponse.json({ error: (e as Error)?.message || 'Could not set the conversion action' }, { status })
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  await clearConversionAction()
  await audit(request, admin.adminId, 'Stopped server-side Google Ads conversion uploads')
  return NextResponse.json({ ok: true })
}

function audit(request: NextRequest, adminId: string | null, summary: string) {
  return logAdminAudit({ adminId, action: 'update', entityType: 'system', entityId: null, summary, request })
}
