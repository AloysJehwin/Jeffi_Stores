import { createServer } from 'node:http'
import IORedis from 'ioredis'
import pg from 'pg'
import { CONFIG, claudeModelFor, ollamaModelFor } from './config'
import { authorized } from './auth'
import { ollamaChat, ollamaEmbed, ollamaInstalledModels, ollamaPool } from './providers/ollama'
import { startUsdInrRefresh } from './fx'
import { anthropicAvailable, anthropicChat, anthropicConfigured, anthropicModels, anthropicVision } from './providers/anthropic'
import { runVision, runOcr, parseOcrRequest, OcrError, OCR_MAX_BASE64, OCR_MODEL, ocrStatus, startOcrProbe, ocrProbe, type OcrHealth } from './providers/paddleocr'
import { azureProvider } from './providers/azure'
import { sarvamProvider } from './providers/sarvam'
import { BackendProbe, RazerHealthMonitor, guardedMedia, httpCheck, poolSource } from './razer-health'
import {
  AUDIO_MAX_BASE64, handleSpeak, handleTranscribe, parseSttProviders, parseTtsProviders, type SttRouterDeps, type TtsRouterDeps,
} from './audio'
import { defaultEmbedProvider, handleEmbed, type EmbedDeps } from './embed'
import { InstalledModels, modelSource, parseModels, razerModels } from './models'
import { providersReport } from './providers-report'
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
import { pexelsProvider } from './providers/pexels'
import { pixabayProvider } from './providers/pixabay'
import { handleStockSearch, parseStockProviders, type StockDeps } from './stock'
import {
  handleImageGenerate, handleVideoStart, readVideoJob, advanceVideoJob, readImageCache,
  parseImageRequest, parseImageProviders, parseVideoProviders, textRoute, chatRoute, visionRoute,
  TEXT_PROVIDER_ORDER, ValidationError, UpstreamError, NotConfiguredError, TRANSPARENT_NEEDS_REPLICATE,
  type ImageRouterDeps, type VideoRouterDeps,
} from './media'
import type {
  AiChatRequest, AiChatResponse, AiChatStreamEvent, EmbedRequest, EmbedResponse, VisionRequest, VisionResponse,
  ImageGenerateRequest, ImageGenerateResponse, ProvidersResponse, OcrResponse, OcrErrorResponse, TextProviderName,
} from '../../sdk/types'

const redis = new IORedis(CONFIG.redisUrl, { maxRetriesPerRequest: 3 })
const pgPool = CONFIG.pgUrl ? new pg.Pool({ connectionString: CONFIG.pgUrl, max: 3 }) : null

// Razer (LLM service) circuit breaker: Ollama via its pool, SD and PaddleOCR via probes.
const sdProbe = new BackendProbe('sd', httpCheck(`${CONFIG.sdWebuiUrl}${CONFIG.sdHealthPath}`, CONFIG.sdHealthTimeoutMs), {
  configured: !!CONFIG.sdWebuiUrl,
  intervalMs: CONFIG.razerProbeIntervalMs,
  failures: CONFIG.razerBreakerFailures,
})
const razer = new RazerHealthMonitor({ ollama: poolSource(ollamaPool), sd: sdProbe, paddleocr: ocrProbe })

// Model lists per provider and capability: requests' `models` are checked against them, /v1/providers reports them.
const ollamaModels = new InstalledModels(ollamaInstalledModels, CONFIG.ollamaProbeIntervalMs * 4)
const models = modelSource({
  anthropic: anthropicModels,
  razer: razerModels(() => ollamaModels.list()),
  azure: cap => azureProvider.models(cap),
  google: cap => googleProvider.models(cap),
  replicate: cap => replicateProvider.models(cap),
  sarvam: cap => sarvamProvider.models(cap),
})

// Media: Redis-backed so any replica can serve a file or advance a job another replica started.
const files = createFileStore(redis)
const imageDeps: ImageRouterDeps = {
  providers: { razer: guardedMedia(sdWebuiProvider, sdProbe), google: googleProvider, replicate: replicateProvider, azure: azureProvider.asImageProvider() },
  order: parseImageProviders(CONFIG.imageProviders),
  files,
  redis,
  fileBaseUrl: CONFIG.publicUrl,
  ttlSec: CONFIG.imageCacheTtlSeconds,
  cutout: replicateProvider,
  available: name => name !== 'razer' || razer.up('image'),
  models,
}
const azureAudio = azureProvider.asAudioProvider()
const sttDeps: SttRouterDeps = { providers: { sarvam: sarvamProvider, azure: azureAudio }, order: parseSttProviders(CONFIG.sttProviders), models }
const ttsDeps: TtsRouterDeps = { providers: { sarvam: sarvamProvider, azure: azureAudio }, order: parseTtsProviders(CONFIG.ttsProviders), models }
const embedDeps: EmbedDeps = {
  defaultProvider: defaultEmbedProvider(CONFIG.embedProvider),
  razer: {
    available: () => razer.up('embed'),
    reason: () => ollamaPool.status().reason || 'Ollama is not reachable',
    embed: (input, model) => runJob<EmbedResponse>({ kind: 'embed', payload: { input, model } }),
  },
  azure: azureProvider,
  models,
}
const videoDeps: VideoRouterDeps = {
  providers: { google: googleProvider, replicate: replicateProvider, azure: azureProvider.asVideoProvider() },
  order: parseVideoProviders(CONFIG.videoProviders),
  jobs: createVideoJobStore(redis),
  files,
  fileBaseUrl: CONFIG.publicUrl,
  models,
}
const stockDeps: StockDeps = {
  providers: { pexels: pexelsProvider, pixabay: pixabayProvider },
  order: parseStockProviders(CONFIG.stockProviders),
  redis,
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
    const out: EmbedResponse = {
      embeddings: r.embeddings, model: m, provider: 'razer', dimensions: r.embeddings[0]?.length ?? 768,
      usage: tokenUsage('ollama', m, r.promptTokens, 0),
    }
    return out
  }
  if (data.kind === 'image') {
    try {
      return await handleImageGenerate(data.payload as ImageGenerateRequest, imageDeps)
    } catch (err) {
      // The queue keeps only the message, so carry each provider's reason in it.
      if (err instanceof UpstreamError && err.tried.length) {
        throw new Error(`${err.message}: ${err.tried.map(t => `${t.provider}: ${t.error}`.slice(0, 300)).join('; ')}`)
      }
      throw err
    }
  }
  if (data.kind === 'vision') {
    const { images, prompt, model } = data.payload as VisionRequest
    return runVision(images, prompt, model)
  }
  throw new Error(`unknown job kind: ${(data as any).kind}`)
}

startWorker(processJob)
ollamaPool.start()
void ollamaModels.refresh()
startOcrProbe()
sdProbe.start()
startUsdInrRefresh()

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

// Fail fast (503) when the last probe found no Ollama, instead of queueing work that will only
// exhaust its retries; the app falls back to direct Ollama on 5xx.
function assertOllamaUp(): void {
  if (ollamaPool.knownDown()) throw new HttpError(503, ollamaPool.status().reason || 'Ollama is not reachable')
}

/** Truthful dependency check (cached ~probe interval). */
async function readiness(): Promise<{ ok: boolean; reason?: string; queue: boolean; ollama: Awaited<ReturnType<typeof ollamaPool.health>>; ocr: OcrHealth; razer: ReturnType<typeof razer.report> }> {
  const [queue, ollama] = await Promise.all([queueHealth(), ollamaPool.health()])
  // With Claude or Azure chat configured, chat survives an Ollama outage, so Ollama alone does not fail readiness.
  const cloudText = anthropicConfigured() || azureProvider.chatConfigured()
  const reasons = [!queue && 'redis queue unreachable', !ollama.ok && !cloudText && (ollama.reason || 'Ollama unreachable')].filter(Boolean)
  // PaddleOCR and SD are reported, never fail readiness: their breakers route around them.
  return { ok: reasons.length === 0, reason: reasons.join('; ') || undefined, queue, ollama, ocr: ocrStatus(), razer: razer.report() }
}

// ── Chat: providers in route order; each answer goes through the two-tier cache ──────────────
type Emit = (e: AiChatStreamEvent) => void

async function handleChat(raw: AiChatRequest, emit?: Emit, signal?: AbortSignal): Promise<AiChatResponse> {
  const req: AiChatRequest = { ...raw, models: parseModels(raw.models, 'text', models) }
  const ready = (p: TextProviderName) => (p === 'anthropic' ? anthropicAvailable(req) : p === 'azure' ? azureProvider.chatConfigured() : true)
  const route = chatRoute(textRoute(req), ready, razer.up('text'))
  if (!route.length) throw new NotConfiguredError('no text provider in the requested order is available')
  const failures: string[] = []
  for (const provider of route) {
    const isLast = provider === route[route.length - 1]
    let emitted = false
    const tracked: Emit | undefined = emit && (e => { emitted = true; emit(e) })
    try {
      const r = provider === 'anthropic' ? await chatAnthropic(req, tracked, signal)
        : provider === 'azure' ? await chatAzure(req, tracked, signal)
          : await chatRazer(req, tracked)
      return failures.length ? { ...r, fallbackUsed: true } : r
    } catch (err) {
      // Partial output already reached the client, or nothing left to try: surface the error.
      if (emitted || isLast || signal?.aborted) throw err
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${provider}: ${msg}`)
      console.warn(`[ai-gateway] text provider ${provider} failed, trying next: ${msg.slice(0, 300)}`)
    }
  }
  throw new UpstreamError('all text providers failed', failures.map(f => ({ provider: f.split(':')[0], error: f })))
}

async function cached(req: AiChatRequest, model: string, provider: AiChatResponse['provider'], start: number): Promise<AiChatResponse | null> {
  const policy = policyFor(req)
  if (policy.kv) {
    const hit = await kvGet(redis, cacheKey(req, model))
    if (hit) return { content: hit.content, provider, model: hit.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'kv', usage: FREE }
  }
  const sem = policy.semantic ? semanticKey(req, model) : null
  if (sem && pgPool) {
    const hit = await semanticGet(pgPool, sem, policy.similarity)
    if (hit) return { content: hit, provider, model, latencyMs: Date.now() - start, fallbackUsed: false, cache: 'semantic', usage: FREE }
  }
  return null
}

async function remember(req: AiChatRequest, model: string, content: string): Promise<void> {
  const policy = policyFor(req)
  if (policy.kv) await kvSet(redis, cacheKey(req, model), { content, model }, policy.ttlSeconds)
  const sem = policy.semantic ? semanticKey(req, model) : null
  if (sem && pgPool) await semanticSet(pgPool, sem, content)
}

async function chatAnthropic(req: AiChatRequest, emit?: Emit, signal?: AbortSignal): Promise<AiChatResponse> {
  const start = Date.now()
  const { model } = claudeModelFor(req)
  const hit = await cached(req, model, 'anthropic', start)
  if (hit) { emit?.({ type: 'text', text: hit.content }); return hit }
  const r = await anthropicChat(req, emit, signal)
  // Only plain, complete text answers are cached (never tool calls).
  if (!r.toolCalls?.length && r.content && r.stopReason === 'end_turn') await remember(req, model, r.content)
  return {
    content: r.content, toolCalls: r.toolCalls, provider: 'anthropic', model: r.model, latencyMs: Date.now() - start,
    fallbackUsed: false, cache: null, usage: r.usage, providerState: r.providerState, stopReason: r.stopReason,
  }
}

async function chatAzure(req: AiChatRequest, emit?: Emit, signal?: AbortSignal): Promise<AiChatResponse> {
  const start = Date.now()
  const model = azureProvider.chatModel(req.models?.azure)
  const hit = await cached(req, model, 'azure', start)
  if (hit) { emit?.({ type: 'text', text: hit.content }); return hit }
  const r = await azureProvider.chat(req, emit, signal)
  if (!r.toolCalls?.length && r.content && r.stopReason === 'end_turn') await remember(req, model, r.content)
  return {
    content: r.content, toolCalls: r.toolCalls, provider: 'azure', model: r.model, latencyMs: Date.now() - start,
    fallbackUsed: false, cache: null, usage: r.usage, stopReason: r.stopReason,
  }
}

async function chatRazer(req: AiChatRequest, emit?: Emit): Promise<AiChatResponse> {
  const start = Date.now()
  const model = ollamaModelFor(req)
  const hit = await cached(req, model, 'ollama', start)
  if (hit) { emit?.({ type: 'text', text: hit.content }); return hit }

  assertOllamaUp()
  const r = await runJob<{ content: string; toolCalls?: AiChatResponse['toolCalls']; model: string; promptTokens?: number; completionTokens?: number }>({ kind: 'chat', payload: req })

  // Only cache plain text answers (never tool calls).
  if (!r.toolCalls?.length && r.content) await remember(req, model, r.content)

  for (const tc of r.toolCalls ?? []) emit?.({ type: 'tool_call', name: tc.name })
  if (r.content) emit?.({ type: 'text', text: r.content })
  const usage = tokenUsage('ollama', r.model, r.promptTokens ?? 0, r.completionTokens ?? 0)
  return { content: r.content, toolCalls: r.toolCalls, provider: 'ollama', model: r.model, latencyMs: Date.now() - start, fallbackUsed: false, cache: null, usage }
}

/** Cloud providers ahead of razer in the text order read the image in turn (with the request's text models);
 *  PaddleOCR/Ollama when razer is reached. razer's text model is not used: an Ollama text model may not read images. */
async function handleVision(raw: VisionRequest): Promise<VisionResponse> {
  const body: VisionRequest = { ...raw, models: parseModels(raw.models, 'text', models) }
  const ready = (p: TextProviderName) => !body.model && (p === 'anthropic' ? anthropicAvailable(body) : p === 'azure' && azureProvider.chatConfigured())
  // A single image can still be read by PaddleOCR while Ollama is down.
  const razerUp = razer.up('vision') || (body.images?.length === 1 && razer.up('ocr'))
  const route = visionRoute(textRoute(body), ready, razerUp)
  if (!route.length) throw new NotConfiguredError('no vision provider in the requested order is available')
  for (const [i, provider] of route.entries()) {
    try {
      if (provider === 'razer') return await runJob<VisionResponse>({ kind: 'vision', payload: body })
      return provider === 'anthropic' ? await anthropicVision(body) : await azureProvider.vision(body)
    } catch (err) {
      if (i === route.length - 1) throw err
      console.warn(`[ai-gateway] ${provider} vision failed, falling back: ${(err as Error).message.slice(0, 300)}`)
    }
  }
  throw new NotConfiguredError('no vision provider in the requested order is available')
}

/** PaddleOCR only, never a model, so a document reads the same every time (KYB). Not queued: an OCR call must not
 *  wait behind long chat jobs, and the sidecar serialises its own inference. 400 bad input, 503 sidecar down. */
async function handleOcr(req: import('node:http').IncomingMessage): Promise<{ status: number; body: OcrResponse | OcrErrorResponse }> {
  try {
    const { data, mime } = parseOcrRequest(await readBody(req, OCR_MAX_BASE64 + 64 * 1024))
    return { status: 200, body: await runOcr(data, mime) }
  } catch (err) {
    const status = err instanceof OcrError || err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500
    const error = err instanceof SyntaxError ? 'body is not JSON' : err instanceof Error ? err.message : 'internal error'
    if (status >= 500) console.warn(`[ai-gateway] PaddleOCR failed: ${error.slice(0, 300)}`)
    return { status, body: { ok: false, error } }
  }
}

// Cached model lists only: the admin reads this with a short timeout, so a slow Ollama must not hold it up.
function report(): ProvidersResponse {
  return providersReport({
    models,
    text: {
      order: TEXT_PROVIDER_ORDER,
      status: {
        anthropic: { name: 'anthropic', configured: anthropicConfigured(), keyFallback: !!CONFIG.anthropicApiKey },
        razer: { name: 'razer', configured: !ollamaPool.knownDown(), healthy: razer.up('text') },
        azure: { name: 'azure', configured: azureProvider.chatConfigured() },
      },
    },
    image: { order: imageDeps.order, providers: imageDeps.providers, healthy: { razer: razer.up('image') } },
    video: videoDeps,
    stt: sttDeps,
    tts: ttsDeps,
    embed: {
      default: embedDeps.defaultProvider,
      status: {
        razer: { name: 'razer', configured: !ollamaPool.knownDown(), healthy: razer.up('embed') },
        azure: { name: 'azure', configured: azureProvider.embedConfigured() },
      },
    },
    ocr: [{ name: 'paddleocr', configured: ocrStatus().ok, healthy: razer.up('ocr') }],
    ocrModel: OCR_MODEL,
    stock: stockDeps,
    razer: razer.report(),
  })
}

// Cache hits cost nothing.
const FREE = { promptTokens: 0, completionTokens: 0, costInr: 0 }

// ── Images: cache check up front, then the durable queue (one attempt: the router already
// falls through providers, and a queue retry would pay for paid providers twice) ──────────
async function handleImage(body: ImageGenerateRequest): Promise<ImageGenerateResponse> {
  const start = Date.now()
  const p = parseImageRequest(body, models)
  // Checked here too: inside the queue a 400 would surface as a 502.
  if (p.transparent && !replicateProvider.configured()) throw new ValidationError(TRANSPARENT_NEEDS_REPLICATE)
  if (typeof p.seed !== 'number') {
    const hit = await readImageCache(redis, p.cacheKey)
    if (hit) return { ...hit, latencyMs: Date.now() - start, cache: 'kv' }
  }
  try {
    return await runJob<ImageGenerateResponse>({ kind: 'image', payload: body }, { attempts: 1 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HttpError(/no image provider (configured|available)/.test(msg) ? 503 : 502, msg)
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
// Past `limit` chars the rest of the body is drained unread and the call fails with a 400.
function readBody(req: import('node:http').IncomingMessage, limit = Infinity): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => {
      if (buf.length > limit) return
      buf += c
      if (buf.length > limit) reject(new HttpError(400, `request body too large (max ${Math.round(limit / 1024 / 1024)} MB)`))
    })
    req.on('end', () => {
      if (buf.length > limit) return
      try { resolve(buf ? JSON.parse(buf) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(s)
}

function errorStatus(err: unknown): number {
  return err instanceof HttpError || err instanceof ValidationError || err instanceof UpstreamError || err instanceof NotConfiguredError
    ? err.status : 500
}

// NDJSON: one AiChatStreamEvent per line, ending with 'done' or 'error'. Headers go out with the
// first frame, so a failure before any output is still a plain JSON error with its status.
async function streamChat(body: AiChatRequest, res: import('node:http').ServerResponse): Promise<void> {
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableFinished) ac.abort() })
  const write = (e: AiChatStreamEvent) => {
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
    res.write(JSON.stringify(e) + '\n')
  }
  try {
    write({ type: 'done', response: await handleChat(body, write, ac.signal) })
  } catch (err) {
    if (!res.headersSent) throw err
    write({ type: 'error', error: err instanceof Error ? err.message : 'internal error', status: errorStatus(err) })
  }
  res.end()
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://gateway')
    const path = url.pathname
    if (!authorized(path, req.headers.authorization, CONFIG.gatewayTokens)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' })
      return void res.end(JSON.stringify({ error: 'unauthorized' }))
    }
    if (req.method === 'GET' && (path === '/readyz' || (path === '/healthz' && url.searchParams.has('deep')))) {
      const r = await readiness()
      return json(res, r.ok ? 200 : 503, r)
    }
    // Liveness: the process answers. Dependency state is reported, never fails the probe.
    if (req.method === 'GET' && path === '/healthz') {
      const o = ollamaPool.status()
      return json(res, 200, { ok: true, ollama: { ok: o.ok, active: o.active, checkedAt: o.checkedAt }, razer: razer.report(), waiters: pendingWaiters() })
    }
    if (req.method === 'GET' && path === '/v1/providers') {
      return json(res, 200, report())
    }
    if (req.method === 'POST' && path === '/v1/chat') {
      return json(res, 200, await handleChat(await readBody(req)))
    }
    if (req.method === 'POST' && path === '/v1/chat/stream') {
      return await streamChat(await readBody(req), res)
    }
    if (req.method === 'POST' && path === '/v1/embed') {
      return json(res, 200, await handleEmbed(await readBody(req), embedDeps))
    }
    // Not queued: cloud calls, nothing to serialise on the GPU.
    if (req.method === 'POST' && path === '/v1/audio/transcribe') {
      return json(res, 200, await handleTranscribe(await readBody(req, AUDIO_MAX_BASE64 + 64 * 1024), sttDeps))
    }
    if (req.method === 'POST' && path === '/v1/audio/speak') {
      return json(res, 200, await handleSpeak(await readBody(req, 256 * 1024), ttsDeps))
    }
    if (req.method === 'POST' && path === '/v1/images/generate') {
      return json(res, 200, await handleImage(await readBody(req)))
    }
    // Not queued: a search is one cached HTTP call, never model work.
    if (req.method === 'POST' && path === '/v1/images/stock') {
      return json(res, 200, await handleStockSearch(await readBody(req, 64 * 1024), stockDeps))
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
      const r = await handleVision(await readBody(req))
      return json(res, !r.ok && ollamaPool.knownDown() ? 503 : 200, r)
    }
    if (req.method === 'POST' && path === '/v1/ocr') {
      const r = await handleOcr(req)
      return json(res, r.status, r.body)
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    const status = errorStatus(err)
    const body: Record<string, unknown> = { error: err instanceof Error ? err.message : 'internal error' }
    if (err instanceof UpstreamError) body.tried = err.tried
    json(res, status, body)
  }
})

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[ai-gateway] listening on :${CONFIG.port} -> ollama [${CONFIG.ollamaBaseUrls.join(', ')}], text order [${TEXT_PROVIDER_ORDER.join(', ')}], stt [${sttDeps.order.join(', ')}], tts [${ttsDeps.order.join(', ')}], embed ${embedDeps.defaultProvider}, auth ${CONFIG.gatewayTokens.length ? 'on' : 'OFF (AI_GATEWAY_TOKEN unset)'}`)
})
