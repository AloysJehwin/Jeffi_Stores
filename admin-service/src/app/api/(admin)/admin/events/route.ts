import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { listAdminNotifications } from '@/lib/shared/admin-notify'
import { getSessionDeadline, revokeSessionById } from '@/lib/auth/auth-sessions'
import { subscribeSessionEvents } from '@/lib/auth/session-events'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'
import { changedSince, DRAFT_RESOURCES } from '@jeffi/draft-locks'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { subscribeLockFrames, type LockFrame } from '@/lib/admin/draft-lock-events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NOTIF_POLL_MS = 5000
const KEEPALIVE_MS = 25000
const DEADLINE_GRACE_MS = 1500

/**
 * One event stream per admin tab. Frames are `{ kind: 'session' | 'notifications' | 'lock', ... }`.
 * Lock frames come from the tenant's pub/sub channel and from a draft_locks.updated_at poll on
 * the same 5 s tick (no Redis, other instances, document-service); clients treat them as idempotent.
 * Session frames: `hello` (current deadline on connect), `deadline` (another tab or browser
 * touched the session), `logout` (the session ended anywhere). The server also arms a timer at
 * the deadline and, when it fires, re-reads the row and revokes it if still idle, so the tab
 * signs out on time whether or not its own timers ran. Passive: never counts as activity.
 */
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request, { passive: true })
  if (!admin?.sessionId) return new Response('Unauthorized', { status: 401 })
  const sessionId = admin.sessionId
  const tenant = await resolveTenant().catch(() => null)
  const inCtx = <T>(fn: () => Promise<T>): Promise<T> => (tenant ? runWithTenantContext(tenant, fn) : fn())

  const encoder = new TextEncoder()
  let closed = false
  let deadlineAt = admin.deadlineAt ? new Date(admin.deadlineAt).getTime() : Date.now() + 60_000
  let expiresAt = admin.expiresAt ? new Date(admin.expiresAt).getTime() : deadlineAt

  const stream = new ReadableStream({
    async start(controller) {
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null
      let unsubscribe: (() => void) | null = null
      let unsubscribeLocks: (() => void) | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null

      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const cleanup = () => {
        if (closed) return
        closed = true
        if (deadlineTimer) clearTimeout(deadlineTimer)
        if (pollTimer) clearInterval(pollTimer)
        if (keepaliveTimer) clearInterval(keepaliveTimer)
        unsubscribe?.()
        unsubscribeLocks?.()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      const sendLogout = (reason: string) => {
        send({ kind: 'session', type: 'logout', reason, serverNow: Date.now() })
        cleanup()
      }

      const armDeadline = () => {
        if (deadlineTimer) clearTimeout(deadlineTimer)
        const wait = Math.max(0, deadlineAt - Date.now()) + DEADLINE_GRACE_MS
        deadlineTimer = setTimeout(
          async () => {
            if (closed) return
            try {
              const d = await inCtx(() => getSessionDeadline(sessionId))
              if (!d) {
                await inCtx(() => revokeSessionById(sessionId, 'idle')).catch(() => {})
                sendLogout('idle')
                return
              }
              deadlineAt = new Date(d.deadlineAt).getTime()
              expiresAt = new Date(d.expiresAt).getTime()
              send({ kind: 'session', type: 'deadline', deadlineAt, expiresAt, serverNow: Date.now() })
              armDeadline()
            } catch {
              deadlineAt = Date.now() + 30_000
              armDeadline()
            }
          },
          Math.min(wait, 2_147_000_000)
        )
      }

      send({ kind: 'session', type: 'hello', deadlineAt, expiresAt, serverNow: Date.now() })
      armDeadline()

      unsubscribe = subscribeSessionEvents(sessionId, ev => {
        if (closed) return
        if (ev.type === 'logout') {
          sendLogout(ev.reason)
          return
        }
        deadlineAt = new Date(ev.deadlineAt).getTime()
        expiresAt = new Date(ev.expiresAt).getTime()
        send({ kind: 'session', type: 'deadline', deadlineAt, expiresAt, serverNow: Date.now() })
        armDeadline()
      })

      // Only drafts the admin may read.
      const canRead = (t: LockFrame['resourceType']) =>
        !!DRAFT_RESOURCES[t] && hasScope(admin.role, admin.scopes, DRAFT_RESOURCES[t].readScope)
      unsubscribeLocks = subscribeLockFrames(tenant?.tenantId ?? null, frame => {
        if (!closed && canRead(frame.resourceType)) send(frame)
      })
      let lockCursor: string | null = null
      const db = { query: (t: string, p?: unknown[]) => query(t, p as any[]) }
      const pollLocks = async () => {
        try {
          const r = await inCtx(() => changedSince(db, lockCursor, { hasScope }))
          lockCursor = r.cursor
          for (const lock of r.locks) {
            if (!canRead(lock.resourceType)) continue
            const type = lock.closedAt ? 'closed' : !lock.ownerId ? 'released' : lock.via === 'takeover' ? 'takeover' : lock.via === 'handover' ? 'handover' : 'acquired'
            send({ kind: 'lock', type, resourceType: lock.resourceType, resourceId: lock.resourceId, lock, by: null, reason: lock.reason, at: lock.updatedAt } satisfies LockFrame)
          }
        } catch {
          /* table missing or transient */
        }
      }

      let lastSignature = ''
      const tick = async () => {
        if (closed) return
        await pollLocks()
        try {
          const { items, unreadCount } = await inCtx(() => listAdminNotifications(admin.role, admin.scopes, 30, admin.adminId))
          const signature = `${unreadCount}:${items[0]?.id ?? ''}:${items[0]?.is_read ?? ''}`
          if (signature !== lastSignature) {
            lastSignature = signature
            send({ kind: 'notifications', items, unreadCount })
          }
        } catch {
          /* transient */
        }
      }
      await tick()
      pollTimer = setInterval(tick, NOTIF_POLL_MS)
      keepaliveTimer = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`))
          } catch {
            /* closed */
          }
        }
      }, KEEPALIVE_MS)

      request.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
