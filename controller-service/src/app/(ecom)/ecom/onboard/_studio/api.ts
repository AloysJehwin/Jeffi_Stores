import type { StudioProduct, StudioSession } from '@controller/lib/site-studio/sessions'
import type { StudioAllowance } from '@controller/lib/site-studio/allowance'
import type { StudioStoreContext } from '@controller/lib/site-studio/context'
import type { ClientSite } from '@controller/lib/showcase-builder/site'
import type { DesignDirection, StudioAnswers, StudioBrief, StudioPlan } from '@/lib/site/studio/types'

// The wizard's side of /api/ecom/onboard/studio/*.

export interface PageOutline {
  sections: { id: string; label: string }[]
}

export type SessionView = Omit<StudioSession, 'catalog' | 'owner_id' | 'brief' | 'plan' | 'directions' | 'direction' | 'answers' | 'pages'> & {
  hasCatalog: boolean
  /** The sample products have photos (the photo step can fail while the image service is down). */
  hasPictures?: boolean
  pages: Record<string, PageOutline>
  answers: Partial<StudioAnswers>
  brief: StudioBrief | null
  plan: StudioPlan | null
  directions: DesignDirection[]
  direction: DesignDirection | null
}

export interface StudioView {
  session: SessionView | null
  allowance: StudioAllowance
  store?: StudioStoreContext
  /** A Showcase's studio: its site (the Details step's draft, or the live one). */
  site?: ClientSite | null
  /** False while Claude is unreachable: the wizard then carries on without the studio. */
  ai?: { available: boolean }
}

export class StudioError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    /** The error's other fields (a paid generation's price, a wallet's top-up link). */
    public data?: Record<string, unknown>
  ) {
    super(message)
  }
}

const BASE = '/api/ecom/onboard/studio'

/**
 * Which of the owner's studios this page works on: the Showcase's on its signup and editor pages (/onboard/showcase,
 * /dashboard/showcase/…), else the store's. Every call below says so (`?product=showcase`), so the two never mix.
 */
export function studioProduct(): StudioProduct {
  return typeof window !== 'undefined' && /\/(onboard|dashboard)\/showcase(\/|$)/.test(window.location.pathname) ? 'showcase' : 'store'
}

/** A studio API URL (`path` under /api/ecom/onboard/studio) for this page's studio. */
export function studioUrl(path = '', params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params)
  if (studioProduct() === 'showcase') q.set('product', 'showcase')
  const qs = q.toString()
  return `${BASE}${path ? `/${path}` : ''}${qs ? `?${qs}` : ''}`
}

export const AI_UNAVAILABLE = 'ai_unavailable'
export const WALLET_LOW = 'wallet_low'

/** The server said Claude is unreachable, so studio AI is off for now. */
export const isAiDown = (e: unknown) => e instanceof StudioError && e.code === AI_UNAVAILABLE

/** A paid generation the wallet can't cover (402); `topUpUrl` says where to add money, when there is a wallet. */
export const isWalletLow = (e: unknown): e is StudioError => e instanceof StudioError && e.code === WALLET_LOW

export async function studioGet(opts: { fresh?: boolean } = {}): Promise<StudioView> {
  const res = await fetch(studioUrl('', opts.fresh ? { fresh: '1' } : {}), { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new StudioError(data.error || 'Could not load the studio', res.status, data.code, data)
  return data as StudioView
}

export async function studioPost<T = StudioView>(path: string, body: object = {}): Promise<T> {
  const res = await fetch(studioUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new StudioError(data.error || 'Something went wrong. Try again.', res.status, data.code, data)
  return data as T
}

/** POSTs and reads the text/event-stream answer, calling onEvent for each event; resolves when the stream ends. */
export async function studioStream(path: string, body: object, onEvent: (event: string, data: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(studioUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}))
    throw new StudioError(data.error || 'Something went wrong. Try again.', res.status, data.code, data)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    let at: number
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, at)
      buf = buf.slice(at + 2)
      let event = 'message'
      const lines: string[] = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart())
      }
      if (!lines.length) continue
      try {
        onEvent(event, JSON.parse(lines.join('\n')))
      } catch {}
    }
    if (done) break
  }
}

/** The preview route for a page key (`store:home` → /home, `business:catalog` → /business:catalog); `extra` adds to the query (a theme to try). */
export function previewSrc(sessionId: string, key: string, device: 'desktop' | 'phone', version = 0, extra: Record<string, string> = {}) {
  const seg = key.startsWith('store:') ? key.slice(6) : key
  const q = new URLSearchParams({ surface: device === 'phone' ? 'web_mobile' : 'web', preview: '1', v: String(version), ...extra })
  return `/onboard/studio/preview/${sessionId}/${encodeURIComponent(seg)}?${q}`
}
