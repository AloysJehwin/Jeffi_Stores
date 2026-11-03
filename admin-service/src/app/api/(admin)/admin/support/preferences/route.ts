import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'
import { adminFor, adminLanguage } from '@/lib/support/http'
import { isSupportLanguage } from '@/lib/support/types'

export const dynamic = 'force-dynamic'

// The agent's chat language: customer messages are shown in it, replies are written in it.
export async function GET(request: NextRequest) {
  const admin = await adminFor(request, 'customers:read', { passive: true })
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ lang: await adminLanguage(admin.adminId) })
}

export async function PATCH(request: NextRequest) {
  const admin = await adminFor(request, 'customers:read')
  if (admin instanceof NextResponse) return admin
  const { lang } = await request.json().catch(() => ({}))
  if (!isSupportLanguage(lang)) return NextResponse.json({ error: 'Unsupported language' }, { status: 400 })
  await query(`UPDATE admins SET support_language = $2 WHERE id = $1`, [admin.adminId, lang])
  return NextResponse.json({ lang })
}
