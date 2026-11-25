// Gateway config — this is where all host/model/provider knowledge now lives (moved
// out of the Next.js app). On the Razer cluster these come from a k8s ConfigMap/Secret;
// in cloud, the same keys point at managed endpoints. The app never sees any of this.
import { parseTokens } from './auth'

export const CONFIG = {
  // Tried in order; the first healthy one is used (see providers/ollama-pool.ts).
  ollamaBaseUrls: parseUrls(process.env.OLLAMA_BASE_URLS || process.env.OLLAMA_BASE_URL || 'http://ollama:11434'),
  ollamaProbeIntervalMs: Number(process.env.OLLAMA_PROBE_INTERVAL_MS) || 15_000,
  paddleOcrUrl: (process.env.PADDLE_OCR_URL || 'http://paddleocr:8866').replace(/\/$/, ''),
  // /v1/ocr's wait for the sidecar (a multi-page PDF on CPU); under the app's 130s.
  paddleOcrTimeoutMs: Number(process.env.PADDLE_OCR_TIMEOUT_MS) || 120_000,
  ollamaHealthTimeoutMs: Number(process.env.OLLAMA_HEALTH_TIMEOUT_MS) || 2_000,
  ollamaRequestTimeoutMs: Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS) || 120_000,
  // How long an HTTP handler waits for its queued job before giving up (the app times out at 130s).
  jobWaitTimeoutMs: Number(process.env.AI_JOB_WAIT_TIMEOUT_MS) || 135_000,

  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',

  // Semantic cache backing store (pgvector) — the ai_cache table. Reuses the same
  // Postgres that holds embeddings.
  pgUrl: process.env.AI_CACHE_PG_URL || process.env.RAG_PG_URL || '',
  embedModel: process.env.RAG_EMBED_MODEL || 'nomic-embed-text',

  port: Number(process.env.PORT) || 8080,
  // Bearer token(s) every /v1 call must carry (comma-separated during a rotation). Empty = no auth.
  gatewayTokens: parseTokens(process.env.AI_GATEWAY_TOKEN || ''),

  // Media: provider order, public base for /v1/files URLs (empty = relative; the SDK absolutises).
  imageProviders: process.env.AI_IMAGE_PROVIDERS || '',
  videoProviders: process.env.AI_VIDEO_PROVIDERS || '',
  publicUrl: (process.env.AI_PUBLIC_URL || '').replace(/\/$/, ''),
  imageCacheTtlSeconds: Number(process.env.AI_IMAGE_CACHE_TTL_SECONDS) || 3600,
  videoPollMs: Number(process.env.AI_VIDEO_POLL_MS) || 10_000,
  // Stock photos (/v1/images/stock): order of pexels,pixabay; each runs only with its key (PEXELS_API_KEY, PIXABAY_API_KEY).
  stockProviders: process.env.AI_STOCK_PROVIDERS || '',

  // Anthropic (Claude) text. No key = provider skipped and text stays on Razer.
  // Production auth is workload identity federation: one Anthropic workspace + service account per
  // store, ids sent per request; the org id and the projected k8s token file are gateway-wide.
  anthropicOrganizationId: process.env.ANTHROPIC_ORGANIZATION_ID || '',
  anthropicIdentityTokenFile: process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || '',
  // Local dev only: a static key used when a request carries no store identity.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicTimeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS) || 120_000,
  // Floor for max_tokens: thinking counts against it, and the cap is billed only when used.
  anthropicMinMaxTokens: Number(process.env.ANTHROPIC_MIN_MAX_TOKENS) || 8000,
  // Server-side refusal fallback on Sonnet/Opus ('off' disables).
  anthropicFallbacks: (process.env.ANTHROPIC_FALLBACKS || 'default') !== 'off',
  // Text provider order (anthropic, razer, azure). Default: anthropic first when the key is set, azure last.
  textProviders: process.env.AI_TEXT_PROVIDERS || '',
  // Audio order (azure). Embeddings use one provider, never an order: razer (Ollama) or azure.
  audioProviders: process.env.AI_AUDIO_PROVIDERS || '',
  embedProvider: process.env.AI_EMBED_PROVIDER || 'razer',

  // Razer (LLM service) circuit breaker: SD and PaddleOCR are probed like the Ollama pool; razer is
  // skipped for a capability after this many failed probes in a row, and re-enters on the next good one.
  sdWebuiUrl: (process.env.SD_WEBUI_URL || '').replace(/\/$/, ''),
  sdHealthPath: process.env.SD_WEBUI_HEALTH_PATH || '/sdapi/v1/options',
  sdHealthTimeoutMs: Number(process.env.SD_HEALTH_TIMEOUT_MS) || 5_000,
  razerProbeIntervalMs: Number(process.env.RAZER_PROBE_INTERVAL_MS) || Number(process.env.OLLAMA_PROBE_INTERVAL_MS) || 15_000,
  razerBreakerFailures: Number(process.env.RAZER_BREAKER_FAILURES) || 2,

  // Azure (Microsoft-sold models only): every call names a deployment from here, never a model id.
  azure: {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, ''),
    apiKey: process.env.AZURE_OPENAI_API_KEY || '',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview',
    chatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '',
    imageDeployment: process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT || '',
    embedDeployment: process.env.AZURE_OPENAI_EMBED_DEPLOYMENT || '',
    transcribeDeployment: process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT || '',
    ttsDeployment: process.env.AZURE_OPENAI_TTS_DEPLOYMENT || '',
    videoDeployment: process.env.AZURE_OPENAI_VIDEO_DEPLOYMENT || '',
    speechKey: process.env.AZURE_SPEECH_KEY || '',
    speechRegion: process.env.AZURE_SPEECH_REGION || 'centralindia',
    timeoutMs: Number(process.env.AZURE_OPENAI_TIMEOUT_MS) || 120_000,
    // Floor for max_completion_tokens: reasoning tokens count against it, and only used tokens are billed.
    minMaxTokens: Number(process.env.AZURE_OPENAI_MIN_MAX_TOKENS) || 4000,
  },
}

export function parseUrls(raw: string): string[] {
  const urls = raw.split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean)
  return [...new Set(urls)]
}

import type { ModelHint } from '../../sdk/types'

const AGENT = process.env.OLLAMA_AGENT_MODEL || 'qwen2.5:7b'
const FAST = process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_EMAIL_MODEL || 'gemma3:4b'

/** Resolve a modelHint to a concrete Ollama model name (was inline in ai-client.ts). */
export function modelForHint(hint: ModelHint | undefined): string {
  switch (hint) {
    case 'sql': return process.env.OLLAMA_SQL_MODEL || 'gemma4:12b'
    case 'agent':
    case 'deep': return AGENT
    case 'fast': return FAST
    case 'email': return process.env.OLLAMA_EMAIL_MODEL || FAST
    case 'enrich': return process.env.OLLAMA_ENRICH_MODEL || FAST
    case 'copy':
    default: return process.env.OLLAMA_COPY_MODEL || 'gemma4:12b'
  }
}

export const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'gemma4:12b'

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const CLAUDE_SONNET = 'claude-sonnet-5-5'
const CLAUDE_HAIKU = 'claude-haiku-5-5'
const effort = (v: string | undefined, d: ClaudeEffort): ClaudeEffort =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).includes(v as ClaudeEffort) ? (v as ClaudeEffort) : d

/** Claude model + effort per hint. Agent/SQL reason over tools (Sonnet); copy/fast work is Haiku. */
export function claudeModelForHint(hint: ModelHint | undefined): { model: string; effort: ClaudeEffort } {
  const env = process.env
  switch (hint) {
    case 'agent': return { model: env.ANTHROPIC_AGENT_MODEL || CLAUDE_SONNET, effort: effort(env.ANTHROPIC_AGENT_EFFORT, 'medium') }
    case 'sql': return { model: env.ANTHROPIC_SQL_MODEL || env.ANTHROPIC_AGENT_MODEL || CLAUDE_SONNET, effort: effort(env.ANTHROPIC_AGENT_EFFORT, 'medium') }
    case 'deep': return { model: env.ANTHROPIC_DEEP_MODEL || 'claude-opus-5-5', effort: effort(env.ANTHROPIC_DEEP_EFFORT, 'high') }
    case 'fast': return { model: env.ANTHROPIC_FAST_MODEL || CLAUDE_HAIKU, effort: 'low' }
    case 'email': return { model: env.ANTHROPIC_EMAIL_MODEL || env.ANTHROPIC_COPY_MODEL || CLAUDE_HAIKU, effort: 'low' }
    case 'enrich': return { model: env.ANTHROPIC_ENRICH_MODEL || env.ANTHROPIC_FAST_MODEL || CLAUDE_HAIKU, effort: 'low' }
    case 'copy':
    default: return { model: env.ANTHROPIC_COPY_MODEL || CLAUDE_HAIKU, effort: effort(env.ANTHROPIC_COPY_EFFORT, 'low') }
  }
}

export const CLAUDE_VISION_MODEL = process.env.ANTHROPIC_VISION_MODEL || CLAUDE_SONNET
