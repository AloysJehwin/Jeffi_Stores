import { NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'
import lazyRedis from '@/lib/shared/redis'

export const dynamic = 'force-dynamic'

/**
 * Readiness probe. Answers "can this instance actually serve requests right now?"
 * — i.e. are its dependencies (Postgres, Redis) reachable. Returns 503 if not,
 * so the ALB target group and the blue/green deploy gate never route traffic to
 * (or promote) an instance that can't reach the DB. Kept cheap: SELECT 1 + PING,
 * each with a short timeout, so it's safe to poll frequently.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ])
}

export async function GET() {
  const checks: Record<string, string> = {}
  let ok = true

  // Postgres: SELECT 1
  try {
    await withTimeout(query('SELECT 1'), 3000, 'db')
    checks.db = 'ok'
  } catch (e: any) {
    ok = false
    checks.db = `fail: ${e?.message || 'error'}`
  }

  // Redis: PING (best-effort — an in-memory fallback still counts as reachable)
  try {
    if (typeof lazyRedis.ping !== 'function') {
      checks.redis = 'ok (no ping; in-memory)'
    } else {
      const pong = await withTimeout(Promise.resolve(lazyRedis.ping()), 2000, 'redis')
      checks.redis = pong === 'PONG' || pong === true ? 'ok' : `unexpected: ${pong}`
    }
  } catch (e: any) {
    ok = false
    checks.redis = `fail: ${e?.message || 'error'}`
  }

  return NextResponse.json({ status: ok ? 'ready' : 'not_ready', checks }, { status: ok ? 200 : 503 })
}
