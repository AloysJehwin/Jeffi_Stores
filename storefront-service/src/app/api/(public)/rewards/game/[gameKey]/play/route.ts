import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { customerProgramsAllowed } from '@/lib/loyalty/settings'
import { findLiveGame, playGame } from '@/lib/rewards/game'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Play once per period; a repeat returns the same result (idempotent), never a second coupon. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ gameKey: string }> }) {
  const { gameKey } = await params
  if (!UUID.test(gameKey)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await customerProgramsAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const game = await findLiveGame(gameKey.toLowerCase())
  if (!game) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const result = await playGame(game, user.userId)
  return NextResponse.json(result)
}
