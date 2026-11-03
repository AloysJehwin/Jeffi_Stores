import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateUser } from '@/lib/auth/jwt'
import { redeemPoints, type RedeemFailure } from '@/lib/loyalty/redeem'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const RedeemSchema = z.object({ points: z.number().int().min(1).max(1_000_000) })

const FAILURE_STATUS: Record<RedeemFailure, number> = {
  disabled: 404,
  not_eligible: 403,
  invalid_points: 400,
  below_minimum: 400,
  insufficient_points: 400,
}

export async function POST(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = parseBody(RedeemSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  try {
    const result = await redeemPoints(authUser.userId, parsed.data.points)
    if (result.ok) {
      return NextResponse.json({
        code: result.code,
        value: result.value,
        points: result.points,
        balance: result.balance,
      })
    }
    const messages: Record<RedeemFailure, string> = {
      disabled: 'Rewards are not available right now',
      not_eligible: 'Rewards are not available for this account',
      invalid_points: 'Enter a whole number of points',
      below_minimum: `You need at least ${result.minimum} points to redeem`,
      insufficient_points: 'You do not have enough points',
    }
    return NextResponse.json(
      { error: messages[result.reason], reason: result.reason },
      { status: FAILURE_STATUS[result.reason] }
    )
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
