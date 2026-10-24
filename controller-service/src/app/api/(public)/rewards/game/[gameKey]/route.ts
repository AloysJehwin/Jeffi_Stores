import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { customerProgramsAllowed } from '@/lib/loyalty/settings'
import { findLiveGame, getGameState } from '@/lib/rewards/game'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether the signed-in customer can play this game now, and their last result. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ gameKey: string }> }) {
  const { gameKey } = await params
  if (!UUID.test(gameKey)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = await authenticateUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await customerProgramsAllowed())) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const game = await findLiveGame(gameKey.toLowerCase())
  if (!game) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await getGameState(game, user.userId))
}
