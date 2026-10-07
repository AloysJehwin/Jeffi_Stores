import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLoyaltyAccount, listLoyaltyLedger } from '@/lib/loyalty/queries'
import { adjustPoints, isLoyaltyEligible, type AdjustFailure } from '@/lib/loyalty/redeem'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { tierName } from '@/lib/loyalty/tiers'
import { parseBody, zUuid } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const AdjustSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  note: z.string().trim().min(1, 'A note is required').max(500),
})

const FAILURES: Record<AdjustFailure, { status: number; error: string }> = {
  disabled: { status: 409, error: 'Loyalty is switched off' },
  not_eligible: { status: 400, error: 'This account cannot earn points' },
  invalid_delta: { status: 400, error: 'Enter a whole number of points other than zero' },
  note_required: { status: 400, error: 'A note is required' },
}

async function loadView(userId: string) {
  const [settings, eligible, account, ledger] = await Promise.all([
    getLoyaltySettings(),
    isLoyaltyEligible(userId),
    getLoyaltyAccount(userId),
    listLoyaltyLedger(userId, 1, 20),
  ])
  return {
    enabled: settings.enabled,
    eligible,
    account: { ...account, tierName: tierName(account.tier) },
    ledger: ledger.items,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!zUuid.safeParse(id).success) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  try {
    return NextResponse.json(await loadView(id))
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!zUuid.safeParse(id).success) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const parsed = parseBody(AdjustSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  try {
    const result = await adjustPoints({ userId: id, ...parsed.data, adminId: admin.adminId })
    if (!result.ok) {
      const failure = FAILURES[result.reason]
      return NextResponse.json({ error: failure.error, reason: result.reason }, { status: failure.status })
    }
    return NextResponse.json(await loadView(id))
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
