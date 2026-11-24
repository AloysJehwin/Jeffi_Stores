import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { handEdited } from '@/lib/site/studio/keep-words'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import type { Owner } from '@/lib/tenant-registry'
import { getStudioSession, type StudioProduct, type StudioSession } from './sessions'
import { allowanceOf } from './allowance'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'

/** The signed-in owner (as the other onboarding routes), or the 401 to return. */
export async function studioOwner(request: NextRequest): Promise<Owner | NextResponse> {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  return owner ?? NextResponse.json({ error: 'Not signed in' }, { status: 401 })
}

/** Which of the owner's studios a request works on: `?product=showcase` (the Showcase signup and editor), else the store's. */
export const studioProductOf = (request: NextRequest): StudioProduct => (request.nextUrl.searchParams.get('product') === 'showcase' ? 'showcase' : 'store')

/** A Showcase studio's site (`?site=`); sessions are read by owner, so another owner's site finds nothing. */
export const studioSiteOf = (request: NextRequest): string | null => {
  const site = request.nextUrl.searchParams.get('site')
  return site && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(site) ? site : null
}

/** The owner and their studio; a 404 when they have not started one. */
export async function studioOf(request: NextRequest): Promise<{ owner: Owner; session: StudioSession } | NextResponse> {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const session = await getStudioSession(owner.id, studioProductOf(request), studioSiteOf(request))
  if (!session) return NextResponse.json({ error: 'Start the studio first' }, { status: 404 })
  return { owner, session }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  const raw = await request.json().catch(() => null)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/** What the wizard sees of a session: the pages as their section lists (the preview renders them), no catalogue. */
export function studioView(s: StudioSession | null) {
  if (!s) return { session: null, allowance: allowanceOf(null) }
  const { catalog, owner_id: _o, pages, ...rest } = s
  const outline = Object.fromEntries(
    Object.entries(pages ?? {}).map(([key, doc]) => [
      key,
      {
        sections: (doc.order ?? []).map(id => ({ id, label: String(doc.blocks?.[id]?.props?.label ?? 'Section'), ...(doc.blocks?.[id]?.visibility?.hidden ? { hidden: true } : {}) })),
        // Changed by hand in the visual editor: a redesign asks first and offers to keep the owner's words.
        ...(handEdited(doc) ? { edited: true } : {}),
      },
    ])
  )
  const products = ((catalog as { products?: { images?: string[]; imagePrompt?: string }[] } | null)?.products ?? [])
  const missingPictures = products.filter(p => !p.images?.length && p.imagePrompt).length
  return { session: { ...rest, pages: outline, hasCatalog: !!catalog, hasPictures: products.some(p => !!p.images?.length), missingPictures }, allowance: allowanceOf(s) }
}

export const fail = (error: string, status = 400, extra?: Record<string, unknown>) => NextResponse.json({ error, ...extra }, { status })

/** Studio AI runs platform-funded on Claude; while Claude is unreachable the owner carries on without it. */
export const studioAiAvailable = (opts?: { fresh?: boolean }) => siteAiAvailable('platform', opts)

/** The 503 for a studio AI request while Claude is unreachable, or null when it is reachable. */
export async function aiUnavailable(): Promise<NextResponse | null> {
  if (await studioAiAvailable()) return null
  return fail(`${AI_UNAVAILABLE_MESSAGE} You can carry on without it.`, 503, { code: AI_UNAVAILABLE_CODE })
}

/** The 503 for an AI call Claude did not answer (the gateway fell back), or null for any other error. */
export const aiDownFrom = (err: unknown) =>
  (err as Error)?.name === 'StudioAiDownError' ? fail(`${AI_UNAVAILABLE_MESSAGE} You can carry on without it.`, 503, { code: AI_UNAVAILABLE_CODE }) : null

export type SseSend = (event: string, data: unknown) => void

/**
 * A text/event-stream response for long AI work. The work keeps going when the browser leaves (what it saves is
 * still there when the wizard comes back); a comment line every 15 s keeps proxies from closing the stream.
 */
export function sseResponse(work: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          open = false
        }
      }
      const send: SseSend = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      const ping = setInterval(() => write(': ping\n\n'), 15_000)
      work(send)
        .catch(err =>
          send('error', { error: (err as Error)?.message?.slice(0, 300) || 'Something went wrong', ...((err as Error)?.name === 'StudioAiDownError' ? { code: AI_UNAVAILABLE_CODE } : {}) })
        )
        .finally(() => {
          clearInterval(ping)
          if (open) {
            open = false
            try {
              controller.close()
            } catch {}
          }
        })
    },
    cancel() {
      open = false
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
