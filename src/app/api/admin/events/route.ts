import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { listAdminNotifications } from '@/lib/admin-notify'
import { getSessionDeadline, revokeSessionById } from '@/lib/auth-sessions'
import { subscribeSessionEvents } from '@/lib/session-events'
import { resolveTenant, runWithTenantContext } from '@/lib/tenant-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NOTIF_POLL_MS = 5000
const KEEPALIVE_MS = 25000
const DEADLINE_GRACE_MS = 1500

/**
 * One event stream per admin tab. Frames are `{ kind: 'session' | 'notifications', ... }`.
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

      let lastSignature = ''
      const tick = async () => {
        if (closed) return
        try {
          const { items, unreadCount } = await inCtx(() => listAdminNotifications(admin.role, admin.scopes))
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
