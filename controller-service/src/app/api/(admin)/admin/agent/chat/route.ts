import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne } from '@/lib/shared/db'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { startTurn, type PageContext } from '@/lib/admin-agent/conversations'
import { cleanPageContext } from '@/lib/admin-agent/page-context'
import { runTurn, type Emit, type TurnContext } from '@/lib/admin-agent/turn'
import { storeTarget, withApproveTarget } from '@/lib/admin-agent/actions/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface IncomingMessage {
  conversationId?: string
  message: string
  /** Where the admin is (the dock sends it): the page path and the record on it. */
  pageContext?: PageContext
  /** Re-run of the last user message (UI retry): skip re-inserting it when it is already stored. */
  retry?: boolean
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as IncomingMessage
  const userMessage = String(body.message || '').trim()
  if (!userMessage) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (userMessage.length > 2000) return NextResponse.json({ error: 'message too long (max 2000)' }, { status: 400 })

  const pageContext = cleanPageContext(body.pageContext)
  const conversationId = await startTurn(admin.adminId, body.conversationId, userMessage, pageContext)
  if (!conversationId) return NextResponse.json({ error: 'Not your conversation' }, { status: 403 })

  const last = body.retry
    ? await queryOne<{ role: string; content: string }>(
        `SELECT role, content FROM admin_agent_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [conversationId]
      ).catch(() => null)
    : null
  if (!(last?.role === 'user' && last.content === userMessage)) {
    await query(
      `INSERT INTO admin_agent_messages (admin_id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [admin.adminId, conversationId, userMessage]
    )
  }

  // A store admin's call_admin_api requests go to the store's own host (see the approve route).
  const tenant = await resolveTenant()
  const ctx: TurnContext = {
    admin: { adminId: admin.adminId, role: admin.role, scopes: admin.scopes },
    conversationId,
    userMessage,
    pageContext,
    cookieHeader: tenant && admin.sid ? `admin_sid=${admin.sid}` : req.headers.get('cookie') || '',
    channel: 'web',
  }
  const target = storeTarget(tenant?.slug)
  if (!(req.headers.get('accept') || '').includes('text/event-stream')) {
    const out = await withApproveTarget(target, () => runTurn(ctx, null, req.signal))
    return NextResponse.json(out.body, { status: out.status })
  }

  // SSE: progress events while the turn runs, then 'done' (the JSON body above) or 'error'.
  const encoder = new TextEncoder()
  const ac = new AbortController()
  req.signal?.addEventListener('abort', () => ac.abort())
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Emit = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* client went away */
        }
      }
      send('meta', { conversationId })
      try {
        const out = await withApproveTarget(target, () => runTurn(ctx, send, ac.signal))
        send(out.status >= 400 ? 'error' : 'done', out.body)
      } catch (err: any) {
        send('error', { error: String(err?.message || 'Agent error') })
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      ac.abort()
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
