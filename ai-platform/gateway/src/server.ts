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
import { tokenUsage } from './pricing'
import { createFileStore } from './files'
import { createVideoJobStore } from './video-jobs'
import { sdWebuiProvider } from './providers/sd-webui'
import { googleProvider } from './providers/google'
import { replicateProvider } from './providers/replicate'
import {
  handleImageGenerate, handleVideoStart, readVideoJob, advanceVideoJob, readImageCache,
  parseImageRequest, parseImageProviders, parseVideoProviders,
  ValidationError, UpstreamError, NotConfiguredError,
  type ImageRouterDeps, type VideoRouterDeps,
} from './media'
import type {
  AiChatRequest, AiChatResponse, EmbedRequest, EmbedResponse, VisionRequest, VisionResponse,
  ImageGenerateRequest, ImageGenerateResponse,
} from '../../sdk/types'

const redis = new IORedis(CONFIG.redisUrl, { maxRetriesPerRequest: 3 })
const pgPool = CONFIG.pgUrl ? new pg.Pool({ connectionString: CONFIG.pgUrl, max: 3 }) : null

// Media: Redis-backed so any replica can serve a file or advance a job another replica started.
const files = createFileStore(redis)
const imageDeps: ImageRouterDeps = {
  providers: { razer: sdWebuiProvider, google: googleProvider, replicate: replicateProvider },
  order: parseImageProviders(CONFIG.imageProviders),
  files,
  redis,
  fileBaseUrl: CONFIG.publicUrl,
  ttlSec: CONFIG.imageCacheTtlSeconds,
}
const videoDeps: VideoRouterDeps = {
  providers: { google: googleProvider, replicate: replicateProvider },
  order: parseVideoProviders(CONFIG.videoProviders),
  jobs: createVideoJobStore(redis),
  files,
  fileBaseUrl: CONFIG.publicUrl,
}

// ── Model work (runs inside the queue worker) ────────────────────────────────
async function processJob(data: JobData): Promise<unknown> {
  if (data.kind === 'chat') {
    return ollamaChat(data.payload as AiChatRequest)
  }
  if (data.kind === 'embed') {
    const { input, model } = data.payload as EmbedRequest
    const arr = Array.isArray(input) ? input : [input]
    const m = model || CONFIG.embedModel
    const r = await ollamaEmbed(arr, m)
    const out: EmbedResponse = { embeddings: r.embeddings, model: m, usage: tokenUsage('ollama', m, r.promptTokens, 0) }
    return out
  }
  if (data.kind === 'image') {
    return handleImageGenerate(data.payload as ImageGenerateRequest, imageDeps)
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
    if (hit) return { content: hit.content, provider: 'ollama', model: hit.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'kv', usage: FREE }
  }
  const sem = policy.semantic ? semanticKey(req, model) : null
  if (sem && pgPool) {
    const hit = await semanticGet(pgPool, sem, policy.similarity)
    if (hit) return { content: hit, provider: 'ollama', model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'semantic', usage: FREE }
  }

  assertOllamaUp()
  const r = await runJob<{ content: string; toolCalls?: AiChatResponse['toolCalls']; model: string; promptTokens?: number; completionTokens?: number }>({ kind: 'chat', payload: req })

  // Only cache plain text answers (never tool calls).
  if (!r.toolCalls?.length && r.content) {
    if (policy.kv) await kvSet(redis, cacheKey(req, model), { content: r.content, model: r.model }, policy.ttlSeconds)
    if (sem && pgPool) await semanticSet(pgPool, sem, r.content)
  }

  const usage = tokenUsage('ollama', r.model, r.promptTokens ?? 0, r.completionTokens ?? 0)
  return { content: r.content, toolCalls: r.toolCalls, provider: 'ollama', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: null, usage }
}

// Cache hits cost nothing.
const FREE = { promptTokens: 0, completionTokens: 0, costInr: 0 }

// ── Images: cache check up front, then the durable queue (one attempt: the router already
// falls through providers, and a queue retry would pay for paid providers twice) ──────────
async function handleImage(body: ImageGenerateRequest): Promise<ImageGenerateResponse> {
  const start = Date.now()
  const p = parseImageRequest(body)
  if (typeof p.seed !== 'number') {
    const hit = await readImageCache(redis, p.cacheKey)
    if (hit) return { ...hit, latencyMs: Date.now() - start, cache: 'kv' }
  }
  try {
    return await runJob<ImageGenerateResponse>({ kind: 'image', payload: body }, { attempts: 1 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HttpError(/no image provider configured/.test(msg) ? 503 : 502, msg)
  }
}

// ── Video poller: advances open jobs; a short Redis lock stops replicas polling the same one ──
async function advanceLocked(jobId: string): Promise<void> {
  const ok = await redis.set(`ai:video:lock:${jobId}`, '1', 'EX', 60, 'NX').catch(() => null)
  if (!ok) return
  try { await advanceVideoJob(jobId, videoDeps) }
  finally { await redis.del(`ai:video:lock:${jobId}`).catch(() => undefined) }
}

let polling = false
const poller = setInterval(async () => {
  if (polling) return
  polling = true
  try {
    for (const j of await videoDeps.jobs.listOpen()) await advanceLocked(j.jobId).catch(() => undefined)
  } finally { polling = false }
}, CONFIG.videoPollMs)
poller.unref()

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
    if (req.method === 'POST' && path === '/v1/images/generate') {
      return json(res, 200, await handleImage(await readBody(req)))
    }
    if (req.method === 'POST' && path === '/v1/video/generate') {
      return json(res, 200, await handleVideoStart(await readBody(req), videoDeps))
    }
    const jobMatch = /^\/v1\/jobs\/([A-Za-z0-9-]{8,64})$/.exec(path)
    if (req.method === 'GET' && jobMatch) {
      const id = jobMatch[1]
      const cur = await readVideoJob(id, videoDeps).catch(() => null)
      if (!cur) return json(res, 404, { error: 'unknown job' })
      if (cur.status === 'queued' || cur.status === 'running') await advanceLocked(id).catch(() => undefined)
      return json(res, 200, await readVideoJob(id, videoDeps))
    }
    const fileMatch = /^\/v1\/files\/([A-Za-z0-9-]{8,64})$/.exec(path)
    if (req.method === 'GET' && fileMatch) {
      const f = await files.get(fileMatch[1])
      if (!f) return json(res, 404, { error: 'file expired or unknown' })
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.bytes.length, 'Cache-Control': 'private, max-age=3600' })
      return void res.end(f.bytes)
    }
    if (req.method === 'POST' && path === '/v1/vision') {
      const r = await runJob<VisionResponse>({ kind: 'vision', payload: await readBody(req) })
      return json(res, !r.ok && ollamaPool.knownDown() ? 503 : 200, r)
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    const status = err instanceof HttpError || err instanceof ValidationError || err instanceof UpstreamError || err instanceof NotConfiguredError
      ? err.status : 500
    const body: Record<string, unknown> = { error: err instanceof Error ? err.message : 'internal error' }
    if (err instanceof UpstreamError) body.tried = err.tried
    json(res, status, body)
  }
})

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[ai-gateway] listening on :${CONFIG.port} -> ollama [${CONFIG.ollamaBaseUrls.join(', ')}]`)
})
