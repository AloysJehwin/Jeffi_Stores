import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPortalToken, PORTAL_COOKIE } from '@/lib/auth/portal-session'
import { downloadableCert, inCertStore } from '@controller/lib/auth/cert-mobile'
import { maskMobile, verifyAdminMobileCode } from '@/lib/auth/admin-mobile'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const Schema = z.object({ serial: z.string().min(1).max(64), otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })

export async function POST(request: NextRequest) {
  const session = await verifyPortalToken(request.cookies.get(PORTAL_COOKIE)?.value).catch(() => null)
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const cert = await downloadableCert(parsed.data.serial, session.email)
  if (!cert) return NextResponse.json({ error: 'Certificate not found for this account' }, { status: 404 })
  const r = await inCertStore(cert.tenant_id, cert.store_name, session.email, async ({ store, admin }) =>
    admin ? verifyAdminMobileCode(store, admin.id, parsed.data.otp) : null
  )
  if (!r) return NextResponse.json({ error: 'No active admin account for this certificate. Ask your store owner.' }, { status: 404 })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ verified: true, mobileHint: maskMobile(r.phone) })
}
