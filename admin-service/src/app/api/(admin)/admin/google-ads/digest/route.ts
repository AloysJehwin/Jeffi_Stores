import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { collectDigest, sendWeeklyDigest } from '@/lib/google-ads/digest'
import { readJson } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: the digest numbers. POST { to: 'me' | 'all' }: send it now (all = everyone with Google Ads access).
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await collectDigest())
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const body = (await readJson(request)) as { to?: string } | null
  const all = body?.to === 'all'
  if (!all && !admin.email) return NextResponse.json({ error: 'Your account has no email address' }, { status: 400 })
  try {
    return NextResponse.json(await sendWeeklyDigest(all ? { force: true } : { to: [admin.email!] }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'Could not send the digest' }, { status: 500 })
  }
}
