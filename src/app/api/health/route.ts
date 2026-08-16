import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Liveness probe. Answers only "is this Node process up and serving HTTP?"
 * It deliberately does NOT touch the DB or Redis, so it never flaps on a
 * transient dependency blip. Use this for the Docker/container liveness check.
 *
 * Readiness (can we actually serve requests — DB + Redis reachable?) lives at
 * /api/ready and is what the ALB target group and the blue/green deploy gate
 * should poll, so we never route traffic to (or promote) a slot that can't
 * reach its dependencies. This split is what would have caught the Aug outage:
 * the app was "alive" but every DB-backed page 500'd.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
