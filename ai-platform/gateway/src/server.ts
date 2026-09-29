import { createServer } from 'node:http'
import IORedis from 'ioredis'
import pg from 'pg'
import { CONFIG, modelForHint } from './config'
import { ollamaChat, ollamaReachable, ollamaEmbed } from './providers/ollama'
import { runVision } from './providers/paddleocr'
import { runJob, startWorker, queueHealth, type JobData } from './queue'
import { policyFor } from './cache/policy'
import { cacheKey, kvGet, kvSet } from './cache/kv'
import { semanticKey, semanticGet, semanticSet } from './cache/semantic'
import type { AiChatRequest, AiChatResponse, EmbedRequest, EmbedResponse, VisionRequest } from '../../sdk/types'

const redis = new IORedis(CONFIG.redisUrl, { maxRetriesPerRequest: 3 })
const pgPool = CONFIG.pgUrl ? new pg.Pool({ connectionString: CONFIG.pgUrl, max: 3 }) : null

// ── Model work (runs inside the queue worker) ────────────────────────────────
async function processJob(data: JobData): Promise<unknown> {
  if (data.kind === 'chat') {
    const req = data.payload as AiChatRequest
    const reachable = await ollamaReachable()
    if (!reachable) throw new Error('Ollama is not reachable')
    return ollamaChat(req)
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
    if (req.method === 'GET' && req.url === '/healthz') {
      const ok = await queueHealth()
      return json(res, ok ? 200 : 503, { ok, queue: ok })
    }
    if (req.method === 'POST' && req.url === '/v1/chat') {
      return json(res, 200, await handleChat(await readBody(req)))
    }
    if (req.method === 'POST' && req.url === '/v1/embed') {
      return json(res, 200, await runJob<EmbedResponse>({ kind: 'embed', payload: await readBody(req) }))
    }
    if (req.method === 'POST' && req.url === '/v1/vision') {
      return json(res, 200, await runJob({ kind: 'vision', payload: await readBody(req) }))
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : 'internal error' })
  }
})

server.listen(CONFIG.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[ai-gateway] listening on :${CONFIG.port} -> ollama ${CONFIG.ollamaBaseUrl}`)
})
