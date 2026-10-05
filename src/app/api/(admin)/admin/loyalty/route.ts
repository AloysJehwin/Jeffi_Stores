import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLoyaltyStats } from '@/lib/loyalty/queries'
import { reconcileLoyaltyUntilDone, type ReconcileResult } from '@/lib/loyalty/reconcile'
import { getLoyaltySettings, LoyaltySettingsInputSchema, saveLoyaltySettings } from '@/lib/loyalty/settings'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const [settings, stats] = await Promise.all([getLoyaltySettings(), getLoyaltyStats()])
  return NextResponse.json({ settings, stats })
}

export async function PUT(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(LoyaltySettingsInputSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  try {
    const before = await getLoyaltySettings()
    await saveLoyaltySettings(parsed.data)
    let firstPass: ReconcileResult | null = null
    if (parsed.data.enabled && !before.launchedAt) firstPass = await reconcileLoyaltyUntilDone()
    return NextResponse.json({ settings: await getLoyaltySettings(), firstPass })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save' }, { status: 500 })
  }
}
