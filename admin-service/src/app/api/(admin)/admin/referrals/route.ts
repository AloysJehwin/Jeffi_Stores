import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getReferralStats } from '@/lib/referrals/queries'
import { getReferralSettings, ReferralSettingsFormSchema, saveReferralSettings } from '@/lib/referrals/settings'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const [settings, stats] = await Promise.all([getReferralSettings(), getReferralStats()])
  return NextResponse.json({ settings, stats })
}

export async function PUT(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(ReferralSettingsFormSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  try {
    // Switching the program on or off is done in Site Controls; keep whatever is stored.
    const before = await getReferralSettings()
    await saveReferralSettings({ ...parsed.data, enabled: before.enabled })
    return NextResponse.json({ settings: await getReferralSettings() })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
  }
}
