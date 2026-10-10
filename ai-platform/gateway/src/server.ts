import { createServer } from 'node:http'
import IORedis from 'ioredis'
import pg from 'pg'
import { CONFIG, modelForHint } from './config'
import { ollamaChat, ollamaEmbed, ollamaPool } from './providers/ollama'
import { runVision } from './providers/paddleocr'
import { runJob, startWorker, queueHealth, pendingWaiters, type JobData } from './queue'
import { policyFor } from './cache/policy'
import { cacheKey, kvGet, kvSet } from './cache/kv'
import { semanticKey, semanticGet, semanticSet } from './cache/semantic'
import type { AiChatRequest, AiChatResponse, EmbedRequest, EmbedResponse, VisionRequest, VisionResponse } from '../../sdk/types'

const redis = new IORedis(CONFIG.redisUrl, { maxRetriesPerRequest: 3 })
const pgPool = CONFIG.pgUrl ? new pg.Pool({ connectionString: CONFIG.pgUrl, max: 3 }) : null

// ── Model work (runs inside the queue worker) ────────────────────────────────
async function processJob(data: JobData): Promise<unknown> {
  if (data.kind === 'chat') {
    return ollamaChat(data.payload as AiChatRequest)
  }
  if (data.kind === 'embed') {
    const { input, model } = data.payload as EmbedRequest
    const arr = Array.isArray(input) ? input : [input]
    return { embeddings: await ollamaEmbed(arr, model), model: model || CONFIG.embedModel }
  }
  if (data.kind === 'vision') {
    const { images, prompt, model } = data.payload as VisionRequest
    return runVision(images, prompt, model)
  }
  throw new Error(`unknown job kind: ${(data as any).kind}`)
}

startWorker(processJob)
ollamaPool.start()

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// Fail fast (503) when the last probe found no Ollama, instead of queueing work that will only
// exhaust its retries; the app falls back to direct Ollama on 5xx.
function assertOllamaUp(): void {
  if (ollamaPool.knownDown()) throw new HttpError(503, ollamaPool.status().reason || 'Ollama is not reachable')
}

/** Truthful dependency check (cached ~probe interval). */
async function readiness(): Promise<{ ok: boolean; reason?: string; queue: boolean; ollama: Awaited<ReturnType<typeof ollamaPool.health>> }> {
  const [queue, ollama] = await Promise.all([queueHealth(), ollamaPool.health()])
  const reasons = [!queue && 'redis queue unreachable', !ollama.ok && (ollama.reason || 'Ollama unreachable')].filter(Boolean)
  return { ok: reasons.length === 0, reason: reasons.join('; ') || undefined, queue, ollama }
}

// ── Chat with the two-tier cache in front of the durable queue ───────────────
async function handleChat(req: AiChatRequest): Promise<AiChatResponse> {
  const start = Date.now()
  const model = modelForHint(req.modelHint)
  const policy = policyFor(req)

  if (policy.kv) {
    const hit = await kvGet(redis, cacheKey(req, model))
    if (hit) return { content: hit.content, provider: 'ollama', model: hit.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'kv' }
  }
  const sem = policy.semantic ? semanticKey(req, model) : null
  if (sem && pgPool) {
    const hit = await semanticGet(pgPool, sem, policy.similarity)
    if (hit) return { content: hit, provider: 'ollama', model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'semantic' }
  }

  assertOllamaUp()
  const r = await runJob<{ content: string; toolCalls?: AiChatResponse['toolCalls']; model: string }>({ kind: 'chat', payload: req })

  // Only cache plain text answers (never tool calls).
  if (!r.toolCalls?.length && r.content) {
    if (policy.kv) await kvSet(redis, cacheKey(req, model), { content: r.content, model: r.model }, policy.ttlSeconds)
    if (sem && pgPool) await semanticSet(pgPool, sem, r.content)
  }

  return { content: r.content, toolCalls: r.toolCalls, provider: 'ollama', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: null }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => { buf += c })
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(s)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://gateway')
    const path = url.pathname
    if (req.method === 'GET' && (path === '/readyz' || (path === '/healthz' && url.searchParams.has('deep')))) {
      const r = await readiness()
      return json(res, r.ok ? 200 : 503, r)
    }
    // Liveness: the process answers. Dependency state is reported, never fails the probe.
    if (req.method === 'GET' && path === '/healthz') {
      const o = ollamaPool.status()
      return json(res, 200, { ok: true, ollama: { ok: o.ok, active: o.active, checkedAt: o.checkedAt }, waiters: pendingWaiters() })
    }
    if (req.method === 'POST' && path === '/v1/chat') {
      return json(res, 200, await handleChat(await readBody(req)))
    }
    if (req.method === 'POST' && path === '/v1/embed') {
      const body = await readBody(req)
      assertOllamaUp()
      return json(res, 200, await runJob<EmbedResponse>({ kind: 'embed', payload: body }))
    }
    if (req.method === 'POST' && path === '/v1/vision') {
      const r = await runJob<VisionResponse>({ kind: 'vision', payload: await readBody(req) })
      return json(res, !r.ok && ollamaPool.knownDown() ? 503 : 200, r)
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    json(res, status, { error: err instanceof Error ? err.message : 'internal error' })
  }
})

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[ai-gateway] listening on :${CONFIG.port} -> ollama [${CONFIG.ollamaBaseUrls.join(', ')}]`)
})
