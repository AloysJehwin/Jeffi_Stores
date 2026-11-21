import { NextResponse } from 'next/server'
import { pingDb, pingStoreDb } from '@/lib/shared/db'
import lazyRedis from '@/lib/shared/redis'

/**
 * Readiness probe: can this instance serve requests right now, i.e. do its databases answer (Redis is
 * reported, not required). 503 when they don't, so traffic never reaches a pod that can't reach its
 * database. A pool with every connection in use counts as answering: a busy pod stays in service.
 * The checks run side by side, inside the kubelet's 5s probe timeout.
 */
const DB_TIMEOUT_MS = 4000

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const settle = (p: Promise<string>) =>
  p.then(
    v => ({ ok: true, v }),
    (e: any) => ({ ok: false, v: `fail: ${e?.message || 'error'}` })
  )

// Reported but never fatal: Redis only holds short-lived keys (codes, counters, locks).
async function redisStatus(): Promise<string> {
  if (typeof lazyRedis.ping !== 'function') return 'ok (no ping; in-memory)'
  try {
    const pong = await withTimeout(Promise.resolve(lazyRedis.ping()), 2000, 'redis')
    return pong === 'PONG' || pong === true ? 'ok' : `unexpected: ${pong}`
  } catch (e: any) {
    return `degraded: ${e?.message || 'error'}`
  }
}

export async function GET() {
  // A pod pinned to one store serves from that store's own database: it must answer too.
  const slug = process.env.SERVICE_TENANT_SLUG || process.env.TENANT_DB_SLUG
  const [db, storeDb, redis] = await Promise.all([
    settle(withTimeout(pingDb(), DB_TIMEOUT_MS, 'db')),
    slug ? settle(withTimeout(pingStoreDb(slug), DB_TIMEOUT_MS, 'store db')) : null,
    redisStatus(),
  ])
  const checks: Record<string, string> = { db: db.v, ...(storeDb && { storeDb: storeDb.v }), redis }
  const ok = db.ok && (storeDb?.ok ?? true)
  return NextResponse.json({ status: ok ? 'ready' : 'not_ready', checks }, { status: ok ? 200 : 503 })
}
