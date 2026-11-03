import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { reconcileLoyaltyUntilDone } from '@/lib/loyalty/reconcile'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    const result = await reconcileLoyaltyUntilDone()
    if (!result.enabled) return NextResponse.json({ error: 'Loyalty is switched off' }, { status: 409 })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Recalculation failed' }, { status: 500 })
  }
}
