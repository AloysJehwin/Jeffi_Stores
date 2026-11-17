import { activeTextProvider, aiChat } from '@/lib/shared/ai-client'

// Site generation runs on Claude only: it needs the AI gateway to answer and Anthropic to serve this store.
// Remembered briefly so a page load does not wait on an unreachable gateway every time.

const seen = new Map<string, { at: number; ok: boolean }>()
const KEEP_MS = { ok: 60_000, down: 15_000 }

export const AI_UNAVAILABLE_CODE = 'ai_unavailable'
export const AI_UNAVAILABLE_MESSAGE = 'AI site generation isn’t available right now.'

// The gateway reports Claude as configured even when its sign-in fails, and then answers from Ollama without an error.
// A site call that came back from another provider is the real signal, so it holds "down" for a while.
const STICKY_MS = 5 * 60_000
let downAt = 0

export function noteSiteAiDown(): void {
  downAt = Date.now()
}

export const siteAiKnownDown = () => Date.now() - downAt < STICKY_MS

async function namespaceKey(cacheNamespace?: string): Promise<string> {
  if (cacheNamespace) return cacheNamespace
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return (await resolveTenantId()) ?? 'platform'
  } catch {
    return 'platform'
  }
}

/** One tiny call that only counts when Claude itself answers (the "Check again" button). */
async function claudeAnswers(cacheNamespace?: string): Promise<boolean> {
  const r = await aiChat({ feature: 'site_builder', messages: [{ role: 'user', content: 'Reply with: ok' }], maxTokens: 5, noCache: true, billing: false, cacheNamespace })
  return r.provider === 'anthropic'
}

/** True when the gateway is reachable and Anthropic (Claude) is the provider site generation would run on. */
export async function siteAiAvailable(cacheNamespace?: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  const key = await namespaceKey(cacheNamespace)
  const hit = seen.get(key)
  if (!opts.fresh && siteAiKnownDown()) return false
  if (!opts.fresh && hit && Date.now() - hit.at < (hit.ok ? KEEP_MS.ok : KEEP_MS.down)) return hit.ok
  let ok = (await activeTextProvider(cacheNamespace).catch(() => 'razer')) === 'anthropic'
  if (ok && opts.fresh) ok = await claudeAnswers(cacheNamespace).catch(() => false)
  if (ok) downAt = 0
  else if (opts.fresh) noteSiteAiDown()
  seen.set(key, { at: Date.now(), ok })
  return ok
}
