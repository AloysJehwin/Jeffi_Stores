import { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { listAdminNotifications } from '@/lib/admin-notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const POLL_MS = 5000
const KEEPALIVE_MS = 25000

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      let lastSignature = ''

      async function tick() {
        try {
          const { items, unreadCount } = await listAdminNotifications(admin!.role, admin!.scopes)
          const signature = `${unreadCount}:${items[0]?.id ?? ''}:${items[0]?.is_read ?? ''}`
          if (signature !== lastSignature) {
            lastSignature = signature
            send({ items, unreadCount })
          }
        } catch {}
      }

      await tick()
      const pollTimer = setInterval(tick, POLL_MS)
      const keepaliveTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: keepalive\n\n`))
      }, KEEPALIVE_MS)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(pollTimer)
        clearInterval(keepaliveTimer)
        try { controller.close() } catch {}
      }

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
