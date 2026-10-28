// App-side AI client. Model host/selection now lives behind the ai-platform gateway
// (see /ai-platform); this file is a thin, signature-preserving HTTP client to it, so the
// 11 AI consumers are unchanged. Durability (queue/retry) and LLM caching are the gateway's job.
// When the gateway is unreachable, times out or answers 5xx (never 4xx), calls go straight to
// Ollama at OLLAMA_BASE_URL (ai-direct-ollama.ts) and come back with fallbackUsed: true.
import { directChat, directEmbed, directVision, ollamaDirectUrl } from './ai-direct-ollama'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id?: string; function: { name: string; arguments: Record<string, unknown> } }>
  tool_call_id?: string
  /** Provider-native assistant content echoed from AiChatResponse.providerState (Claude tool loops). */
  providerState?: { provider: 'anthropic'; content: unknown[] }
}

export interface AiToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AiChatRequest {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  modelHint?: 'sql' | 'copy' | 'agent' | 'fast' | 'enrich' | 'email' | 'deep'
  forceProvider?: 'openai' | 'ollama' | 'anthropic'
  tools?: AiToolDef[]
  noCache?: boolean
  /** Cache partition. Defaults to the current tenant; background jobs must pass it explicitly. */
  cacheNamespace?: string
  /** Billing feature key (lib/ai/billing). Omit to log under 'text'. */
  feature?: string
  /** Set false to skip usage logging + wallet charge (health checks, probes). Default true. */
  billing?: boolean
}

export interface AiToolCall {
  id?: string
  name: string
  arguments: Record<string, unknown>
}

export interface AiChatUsage {
  promptTokens?: number
  completionTokens?: number
  costInr?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Input tokens weighted to the uncached input price; tenant billing uses this. */
  billedPromptTokens?: number
}

export interface AiChatResponse {
  content: string
  toolCalls?: AiToolCall[]
  provider: 'openai' | 'ollama' | 'anthropic'
  model: string
  latencyMs: number
  fallbackUsed: boolean
  cache?: 'kv' | 'semantic' | null
  /** Gateway usage block (ai-platform/gateway). May be absent until stream A lands; treat as zero. */
  usage?: AiChatUsage
  /** Echo on the next request's assistant message so Claude tool loops replay unchanged. */
  providerState?: { provider: 'anthropic'; content: unknown[] }
  stopReason?: string
}

/** Streaming chat events (aiChatStream). */
export type AiChatStreamEvent = { type: 'text'; text: string } | { type: 'tool_call'; id?: string; name: string }

export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AiClientError'
  }
}

const GATEWAY_URL = (process.env.AI_GATEWAY_URL || 'http://100.82.208.8:8080').replace(/\/$/, '')
const GATEWAY_TIMEOUT_MS = Number(process.env.AI_GATEWAY_TIMEOUT_MS) || 130_000
// Short reachability check, so a dead gateway costs seconds, not the full generation timeout.
const GATEWAY_CONNECT_TIMEOUT_MS = Number(process.env.AI_GATEWAY_CONNECT_TIMEOUT_MS) || 3_000
const DIRECT_TIMEOUT_MS = Number(process.env.OLLAMA_DIRECT_TIMEOUT_MS) || 120_000
const GATEWAY_DOWN_COOLDOWN_MS = 30_000
const GATEWAY_FRESH_MS = 60_000
const MIN_DIRECT_MS = 15_000

let lastContactAt = 0
let downUntil = 0
let preflight: Promise<boolean> | null = null

export function aiGatewayUrl(): string {
  return GATEWAY_URL
}

/** Test hook: forget gateway reachability state. */
export function __resetAiClientState(): void {
  lastContactAt = 0
  downUntil = 0
  preflight = null
}

class GatewayFailure extends AiClientError {
  constructor(message: string, readonly retryable: boolean, cause?: unknown) {
    super(message, 'gateway', cause)
  }
}

// Recent contact → assume up; otherwise one shared short GET /healthz. Any HTTP answer counts
// as reachable (a 5xx is handled per request); a connect error/timeout opens a 30s cooldown.
async function gatewayReachable(): Promise<boolean> {
  const now = Date.now()
  if (now < downUntil) return false
  if (now - lastContactAt < GATEWAY_FRESH_MS) return true
  preflight ??= (async () => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), GATEWAY_CONNECT_TIMEOUT_MS)
    try {
      await fetch(`${GATEWAY_URL}/healthz`, { signal: ctrl.signal })
      lastContactAt = Date.now()
      return true
    } catch {
      downUntil = Date.now() + GATEWAY_DOWN_COOLDOWN_MS
      return false
    } finally {
      clearTimeout(t)
      preflight = null
    }
  })()
  return preflight
}

async function gatewayPost(path: string, body: unknown, label: string, withBody: boolean): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    })
  } catch (err) {
    clearTimeout(t)
    if ((err as Error)?.name !== 'AbortError') downUntil = Date.now() + GATEWAY_DOWN_COOLDOWN_MS
    throw new GatewayFailure(err instanceof Error ? err.message : 'AI gateway request failed', true, err)
  }
  try {
    lastContactAt = Date.now()
    if (!res.ok) {
      const detail = withBody ? `: ${await res.text().catch(() => '')}` : ''
      throw new GatewayFailure(`AI gateway ${label}HTTP ${res.status}${detail}`, res.status >= 500)
    }
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

type Direct<T> = (timeoutMs: number) => Promise<T>

/** Direct Ollama only when Site Controls lists Razer for this store; no built-in fallback. */
function directFor<T>(providers: string[] | undefined, direct: Direct<T>): Direct<T> | 'razer-off' | null {
  return providers?.includes('razer') ? direct : providers?.length ? 'razer-off' : null
}

async function withFallback<T>(op: string, gateway: () => Promise<T>, direct: Direct<T> | 'razer-off' | null): Promise<T> {
  const start = Date.now()
  const fallback = ollamaDirectUrl() && typeof direct === 'function' ? direct : null
  if (fallback && !(await gatewayReachable())) {
    console.error(`[ai-client] gateway ${GATEWAY_URL} unreachable; ${op} via direct Ollama`)
    return runDirect(op, fallback, DIRECT_TIMEOUT_MS)
  }
  try {
    return await gateway()
  } catch (err) {
    if (direct === 'razer-off' && err instanceof GatewayFailure && err.retryable) {
      throw new AiClientError(`AI unavailable (${err.message}); Razer is off in Site Controls → Providers, so nothing else can answer`, 'gateway', err)
    }
    if (!fallback || !(err instanceof GatewayFailure) || !err.retryable) throw err
    console.error(`[ai-client] gateway ${op} failed (${err.message.slice(0, 300)}); falling back to direct Ollama`)
    // One overall budget, so a slow gateway plus a fallback cannot double the caller's wait.
    const remaining = GATEWAY_TIMEOUT_MS + 20_000 - (Date.now() - start)
    return runDirect(op, fallback, Math.min(DIRECT_TIMEOUT_MS, Math.max(MIN_DIRECT_MS, remaining)), err)
  }
}

async function runDirect<T>(op: string, direct: (timeoutMs: number) => Promise<T>, timeoutMs: number, gatewayErr?: Error): Promise<T> {
  try {
    return await direct(timeoutMs)
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    console.error(`[ai-client] direct Ollama ${op} failed: ${msg}`)
    const prefix = gatewayErr ? `AI gateway failed (${gatewayErr.message}); ` : 'AI gateway unreachable; '
    throw new AiClientError(`${prefix}direct Ollama fallback failed: ${msg}`, 'ollama', e)
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function currentTenant(): Promise<string | null> {
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return (await resolveTenantId()) ?? null
  } catch {
    return null
  }
}

/** Per-request gateway context: cache partition, the store's provider order and its Claude identity. */
async function gatewayContext(cacheNamespace: string | undefined) {
  const ns = cacheNamespace ?? (await currentTenant()) ?? 'platform'
  // Policy and identity follow the store the work is for: a tenant-id namespace, the flagship for
  // 'platform', else (undefined) the tenant in the current request scope.
  const store = UUID_RE.test(ns) ? ns : ns === 'platform' ? null : undefined
  const policy = await import('@/lib/providers/policy')
  const [routing, anthropicIdentity] = await Promise.all([
    Promise.resolve()
      .then(() => policy.getAiRouting(store))
      .catch(() => ({}) as { text?: string[] }),
    Promise.resolve()
      .then(() => policy.getAnthropicIdentity(store))
      .catch(() => null),
  ])
  return { cacheNamespace: ns, providers: routing.text, anthropicIdentity: anthropicIdentity ?? undefined }
}

export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  const ctx = await gatewayContext(req.cacheNamespace)
  const res = await withFallback(
    'chat',
    () => gatewayPost('/v1/chat', { ...req, ...ctx }, '', true) as Promise<AiChatResponse>,
    directFor(ctx.providers, ms => directChat(req, ms)),
  )
  if (req.billing !== false) {
    void logChatUsage(req, res).catch(err => console.warn('[ai-client] usage log failed:', (err as Error).message))
  }
  return res
}

/**
 * Streaming variant of aiChat: text deltas and tool-call starts arrive through onEvent while the
 * model runs; resolves with the same final response. Usage is recorded once, at the end. When the
 * gateway stream fails before any output, falls back to aiChat (Ollama only when Site Controls lists Razer).
 */
export async function aiChatStream(
  req: AiChatRequest,
  opts: { onEvent?: (e: AiChatStreamEvent) => void; signal?: AbortSignal } = {}
): Promise<AiChatResponse> {
  let emitted = false
  let res: AiChatResponse | null = null
  if (await gatewayReachable()) {
    try {
      res = await gatewayStream(req, e => {
        emitted = true
        opts.onEvent?.(e)
      }, opts.signal)
    } catch (err) {
      if (emitted || opts.signal?.aborted) throw err
      console.error(`[ai-client] gateway stream failed (${(err as Error).message.slice(0, 300)}); retrying without streaming`)
    }
  }
  if (!res) {
    const r = await aiChat(req)
    if (r.toolCalls?.length) for (const tc of r.toolCalls) opts.onEvent?.({ type: 'tool_call', id: tc.id, name: tc.name })
    if (r.content) opts.onEvent?.({ type: 'text', text: r.content })
    return r
  }
  if (req.billing !== false) {
    void logChatUsage(req, res).catch(err => console.warn('[ai-client] usage log failed:', (err as Error).message))
  }
  return res
}

async function gatewayStream(req: AiChatRequest, onEvent: (e: AiChatStreamEvent) => void, signal?: AbortSignal): Promise<AiChatResponse> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const body = { ...req, ...(await gatewayContext(req.cacheNamespace)) }
    const res = await fetch(`${GATEWAY_URL}/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    })
    lastContactAt = Date.now()
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new GatewayFailure(`AI gateway stream HTTP ${res.status}: ${detail}`, res.status >= 500)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0 || (done && buf.trim())) {
        const line = (nl >= 0 ? buf.slice(0, nl) : buf).trim()
        buf = nl >= 0 ? buf.slice(nl + 1) : ''
        if (!line) continue
        const e = JSON.parse(line)
        if (e.type === 'done') return e.response as AiChatResponse
        if (e.type === 'error') throw new AiClientError(`AI gateway: ${e.error}`, 'gateway')
        onEvent(e as AiChatStreamEvent)
      }
      if (done) break
    }
    throw new AiClientError('AI gateway stream ended without a result', 'gateway')
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

let providersCache: {
  at: number
  text: { name: string; configured: boolean; keyFallback?: boolean }[]
  defaults: string[]
} | null = null

/** The text provider the next chat will most likely run on ('anthropic' or 'razer'). */
export async function activeTextProvider(cacheNamespace?: string): Promise<'anthropic' | 'razer'> {
  try {
    if (!providersCache || Date.now() - providersCache.at > 60_000) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), GATEWAY_CONNECT_TIMEOUT_MS)
      try {
        const r = await fetch(`${GATEWAY_URL}/v1/providers`, { signal: ctrl.signal })
        const d = await r.json()
        providersCache = { at: Date.now(), text: d.text ?? [], defaults: d.defaults?.text ?? [] }
      } finally {
        clearTimeout(t)
      }
    }
    const ctx = await gatewayContext(cacheNamespace)
    const order = ctx.providers?.length ? ctx.providers : providersCache.defaults
    // Claude serves this store only with its workload identity, or via the gateway's dev key.
    const usable = (p: string) =>
      providersCache!.text.some(
        t => t.name === p && t.configured && (p !== 'anthropic' || !!ctx.anthropicIdentity || !!t.keyFallback)
      )
    return order.find(usable) === 'anthropic' ? 'anthropic' : 'razer'
  } catch {
    return 'razer'
  }
}

/** Fire-and-forget: record and charge for a completed chat call. Text charging runs AFTER the
 *  call because the token counts are only known then; a shortfall still returns the result and
 *  logs the row with status 'unpaid'. Opt out with `billing: false`. */
async function logChatUsage(req: AiChatRequest, res: AiChatResponse): Promise<void> {
  const { recordUsage } = await import('@/lib/ai/billing')
  const pt = Number(res.usage?.promptTokens ?? 0)
  const ct = Number(res.usage?.completionTokens ?? 0)
  // Claude prompts bill cache-weighted (reads/writes scaled to the input price).
  const billedIn = Number(res.usage?.billedPromptTokens ?? pt)
  const units = [
    { type: 'token_1k_in' as const, qty: billedIn / 1000 },
    { type: 'token_1k_out' as const, qty: ct / 1000 },
  ]
  const costInr = Number(res.usage?.costInr ?? 0)
  try {
    await recordUsage({
      feature: req.feature ?? 'text',
      capability: 'text',
      provider: res.provider || 'ollama',
      model: res.model || '',
      units,
      costInr,
      latencyMs: res.latencyMs,
      cache: res.cache ?? null,
    })
  } catch (err) {
    // AiWalletError already left an 'unpaid' row; the call succeeded, so swallow.
    const { AiWalletError } = await import('@/lib/ai/billing')
    if (!(err instanceof AiWalletError)) throw err
    console.warn('[ai-client] text call succeeded but wallet could not pay; usage marked unpaid')
  }
}

export function getAiProvider(): 'openai' | 'ollama' {
  return (process.env.AI_PROVIDER || 'ollama').toLowerCase() as 'openai' | 'ollama'
}

/** Embeddings via the gateway (used by RAG). Returns one vector per input. */
export async function aiEmbed(
  input: string | string[],
  model?: string,
  opts: { feature?: string; billing?: boolean } = {}
): Promise<number[][]> {
  let usage: AiChatResponse['usage']
  let usedModel = model || ''
  const started = Date.now()
  const out = await withFallback(
    'embed',
    async () => {
      const r = await gatewayPost('/v1/embed', { input, model }, 'embed ', false)
      usage = r.usage
      usedModel = r.model || usedModel
      return r.embeddings as number[][]
    },
    ms => directEmbed(input, model, ms),
  )
  if (opts.billing !== false) {
    void (async () => {
      const { recordUsage, AiWalletError } = await import('@/lib/ai/billing')
      await recordUsage({
        feature: opts.feature ?? 'embed',
        capability: 'embed',
        provider: 'ollama',
        model: usedModel,
        units: [{ type: 'token_1k_in', qty: Number(usage?.promptTokens ?? 0) / 1000 }],
        costInr: Number(usage?.costInr ?? 0),
        latencyMs: Date.now() - started,
      }).catch(err => {
        if (!(err instanceof AiWalletError)) throw err
      })
    })().catch(err => console.warn('[ai-client] embed usage log failed:', (err as Error).message))
  }
  return out
}

export interface AiVisionResult {
  ok: boolean
  text: string
  model: string
  pages?: number
  error?: string
  hint?: string
  provider?: string
  usage?: AiChatUsage
  /** True when served by direct Ollama because the gateway was down. */
  fallbackUsed?: boolean
}

/** Vision/OCR via the gateway. `images` are base64 (no data: prefix). Never throws. Usage is
 *  recorded under capability 'vision' (Claude by tokens, OCR/Ollama per call). */
export async function aiVision(
  images: string[],
  prompt: string,
  model?: string,
  opts: { feature?: string; billing?: boolean; cacheNamespace?: string } = {}
): Promise<AiVisionResult> {
  const started = Date.now()
  let r: AiVisionResult
  try {
    const ctx = await gatewayContext(opts.cacheNamespace)
    r = await withFallback(
      'vision',
      () => gatewayPost('/v1/vision', { images, prompt, model, ...ctx }, 'vision ', false) as Promise<AiVisionResult>,
      directFor(ctx.providers, ms => directVision(images, prompt, model, ms)),
    )
  } catch (err) {
    return {
      ok: false,
      text: '',
      model: model || '',
      error: err instanceof Error ? err.message : 'vision request failed',
    }
  }
  if (r.ok && opts.billing !== false) void logVisionUsage(r, opts.feature ?? 'vision', Date.now() - started)
  return r
}

async function logVisionUsage(r: AiVisionResult, feature: string, latencyMs: number): Promise<void> {
  try {
    const { recordUsage, AiWalletError } = await import('@/lib/ai/billing')
    const claude = r.provider === 'anthropic'
    const units = claude
      ? [
          { type: 'token_1k_in' as const, qty: Number(r.usage?.billedPromptTokens ?? r.usage?.promptTokens ?? 0) / 1000 },
          { type: 'token_1k_out' as const, qty: Number(r.usage?.completionTokens ?? 0) / 1000 },
        ]
      : [{ type: 'call' as const, qty: 1 }]
    await recordUsage({
      feature,
      capability: 'vision',
      provider: claude ? 'anthropic' : 'ollama',
      model: r.model || '',
      units,
      costInr: Number(r.usage?.costInr ?? 0),
      latencyMs,
    }).catch(err => {
      if (!(err instanceof AiWalletError)) throw err
    })
  } catch (err) {
    console.warn('[ai-client] vision usage log failed:', (err as Error).message)
  }
}
