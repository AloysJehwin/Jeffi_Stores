import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, authenticateAnyUser, authenticateBusiness } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { getSessionRow, type SessionRow } from './sessions'
import type { SupportChannel, SupportMessage } from './types'

// Shared bits of the support routes: who is asking, which chat, and the pre-2.0 response shape
// that older app builds still read.

type AuthUser = NonNullable<Awaited<ReturnType<typeof authenticateAnyUser>>>
type Admin = NonNullable<Awaited<ReturnType<typeof authenticateAdmin>>>

export const fail = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function customerChat(request: NextRequest, sessionId: string): Promise<{ user: AuthUser; session: SessionRow } | NextResponse> {
  // EventSource and sendBeacon can't set the portal header, so the business portal says so in the URL.
  const user = request.nextUrl.searchParams.get('portal') === 'business' ? await authenticateBusiness(request) : await authenticateAnyUser(request)
  if (!user) return fail(401, 'Unauthorized')
  const session = await getSessionRow(sessionId).catch(() => null)
  if (!session || session.user_id !== user.userId) return fail(404, 'Session not found')
  return { user, session }
}

export async function adminFor(request: NextRequest, scope: 'customers:read' | 'customers:write', opts: { passive?: boolean } = {}): Promise<Admin | NextResponse> {
  const admin = await authenticateAdmin(request, opts.passive ? { passive: true } : undefined)
  if (!admin) return fail(401, 'Unauthorized')
  if (!hasScope(admin.role, admin.scopes, scope)) return fail(403, 'Insufficient permissions')
  return admin
}

export async function adminChat(request: NextRequest, sessionId: string, scope: 'customers:read' | 'customers:write', opts: { passive?: boolean } = {}): Promise<{ admin: Admin; session: SessionRow } | NextResponse> {
  const admin = await adminFor(request, scope, opts)
  if (admin instanceof NextResponse) return admin
  const session = await getSessionRow(sessionId).catch(() => null)
  if (!session) return fail(404, 'Session not found')
  return { admin, session }
}

export async function adminLanguage(adminId: string): Promise<string> {
  const r = await queryOne<{ support_language: string | null }>(`SELECT support_language FROM admins WHERE id = $1`, [adminId]).catch(() => null)
  return r?.support_language || 'en'
}

/** The agent as the chat shows them: name and chat language. */
export async function agentRef(admin: Admin): Promise<{ adminId: string; name: string; lang: string }> {
  const r = await queryOne<{ name: string | null; support_language: string | null }>(
    `SELECT NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS name, a.support_language
       FROM admins a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [admin.adminId]
  ).catch(() => null)
  return { adminId: admin.adminId, name: r?.name || admin.email || 'Support', lang: r?.support_language || 'en' }
}

/** The app sends its own User-Agent; everything else is the website. */
export function clientChannel(request: NextRequest): SupportChannel {
  return /^JeffiStoresApp\//.test(request.headers.get('user-agent') ?? '') ? 'app' : 'web'
}

/** Clients built for Support 2.0 ask for the new shapes with ?v=2. */
export const isV2 = (request: NextRequest) => request.nextUrl.searchParams.get('v') === '2'

/** Pre-2.0 message shape (sender user/admin/bot, raw text). */
export function legacyMessage(m: SupportMessage) {
  return {
    id: m.id,
    sender: m.sender === 'customer' ? 'user' : m.sender === 'admin' ? 'admin' : 'bot',
    message: m.text,
    created_at: m.at,
    sender_name: m.sender === 'admin' ? m.senderName : undefined,
    is_closing: false,
  }
}

export function legacySession(s: SessionRow) {
  return { id: s.id, status: s.status, created_at: s.created_at, admin_name: s.admin_name }
}

/** Server-sent events from a support channel: keepalives, cleanup on disconnect. */
export function sseStream(request: NextRequest, start: (send: (data: unknown) => void) => Promise<() => void>, opts: { onTick?: () => void; tickMs?: number } = {}): Response {
  const encoder = new TextEncoder()
  let closed = false
  let cleanup: (() => void) | null = null
  let keepalive: ReturnType<typeof setInterval> | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        if (keepalive) clearInterval(keepalive)
        if (tick) clearInterval(tick)
        cleanup?.()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      request.signal.addEventListener('abort', close)
      cleanup = await start(send)
      keepalive = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          close()
        }
      }, 25_000)
      if (opts.onTick) tick = setInterval(opts.onTick, opts.tickMs ?? 20_000)
    },
    cancel() {
      closed = true
      if (keepalive) clearInterval(keepalive)
      if (tick) clearInterval(tick)
      cleanup?.()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
