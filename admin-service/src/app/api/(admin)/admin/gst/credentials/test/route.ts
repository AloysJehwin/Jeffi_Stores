import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { resolveGstApiCreds, GstApiNotConnectedError, GST_API_LABEL } from '@/lib/shipping/gst-api-creds'
import { authenticateEWayBill } from '@/lib/shipping/ewaybill'
import { authenticateEInvoice } from '@/lib/shipping/einvoice'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Test: fetch an auth token with the store's credentials (the flagship: the platform env).
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'gst:write')
  if (admin instanceof NextResponse) return admin
  const parsed = z.object({ provider: z.enum(['ewaybill', 'einvoice']) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  const provider = parsed.data.provider
  try {
    const creds = await resolveGstApiCreds(provider)
    if (!creds) return NextResponse.json({ ok: false, message: `The platform's ${GST_API_LABEL[provider]} credentials are not set.` })
    await (provider === 'ewaybill' ? authenticateEWayBill(creds) : authenticateEInvoice(creds))
    return NextResponse.json({ ok: true, message: `Signed in to the ${GST_API_LABEL[provider]} API as GSTIN ${creds.gstin}.` })
  } catch (e) {
    if (e instanceof GstApiNotConnectedError) return NextResponse.json({ ok: false, message: e.message })
    return NextResponse.json({ ok: false, message: (e as Error)?.message || 'The test failed' })
  }
}
