// End-to-end AI monitor behind the ai_health cron: a tiny real chat through the gateway (no
// fallback, no cache) plus a direct-Ollama reachability check. Alerts the platform admin once
// per incident and once on recovery; incident state lives in Redis.
import { aiGatewayUrl } from '@/lib/shared/ai-client'
import { directReachable, ollamaDirectUrl } from '@/lib/shared/ai-direct-ollama'
import { getRedisClient } from '@/lib/shared/redis'

export const INCIDENT_KEY = 'ai:health:incident'
const INCIDENT_TTL_S = 7 * 24 * 3600
const CHAT_TIMEOUT_MS = Number(process.env.AI_HEALTH_CHAT_TIMEOUT_MS) || 60_000

export interface AiHealthResult {
  ok: boolean
  gateway: { ok: boolean; latencyMs: number; error?: string; readyz?: string }
  ollama: { ok: boolean | null; error?: string }
  reasons: string[]
}

interface Incident {
  since: string
  reasons: string[]
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

function errText(e: unknown, timeoutMs: number): string {
  const err = e as Error & { cause?: { code?: string } }
  return err?.name === 'AbortError' ? `timeout ${timeoutMs}ms` : err?.cause?.code || err?.message || String(e)
}

async function checkGateway(): Promise<AiHealthResult['gateway']> {
  const base = aiGatewayUrl()
  const start = Date.now()
  try {
    const res = await timedFetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        modelHint: 'fast',
        maxTokens: 5,
        temperature: 0,
        noCache: true,
        cacheNamespace: 'ai-health',
      }),
    }, CHAT_TIMEOUT_MS)
    const latencyMs = Date.now() - start
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      return { ok: false, latencyMs, error: `gateway chat HTTP ${res.status}: ${body}`, readyz: await readyz(base) }
    }
    const data = await res.json().catch(() => null)
    if (typeof data?.content !== 'string') return { ok: false, latencyMs, error: 'gateway chat returned no content' }
    return { ok: true, latencyMs }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: `gateway chat failed: ${errText(e, CHAT_TIMEOUT_MS)}`, readyz: await readyz(base) }
  }
}

// The gateway's own dependency verdict, for the alert body (older gateways 404: ignored).
async function readyz(base: string): Promise<string | undefined> {
  try {
    const res = await timedFetch(`${base}/readyz`, {}, 5_000)
    if (res.status === 404) return undefined
    const data = await res.json().catch(() => null)
    return `HTTP ${res.status}${data?.reason ? `: ${data.reason}` : ''}`
  } catch (e) {
    return `unreachable: ${errText(e, 5_000)}`
  }
}

export async function runAiHealthCheck(): Promise<AiHealthResult> {
  const [gateway, ollama] = await Promise.all([
    checkGateway(),
    ollamaDirectUrl() ? directReachable() : Promise.resolve({ ok: null as boolean | null, error: 'OLLAMA_BASE_URL not set' }),
  ])
  const reasons: string[] = []
  if (!gateway.ok) reasons.push(`${gateway.error}${gateway.readyz ? ` (gateway /readyz ${gateway.readyz})` : ''}`)
  if (ollama.ok === false) reasons.push(`direct Ollama ${ollamaDirectUrl()} unreachable (${ollama.error}); app fallback unavailable`)
  return { ok: reasons.length === 0, gateway, ollama, reasons }
}

export type IncidentTransition = 'healthy' | 'opened' | 'ongoing' | 'recovered'
export type AlertSender = (subject: string, body: string) => Promise<void>

/** Real mail only from production; elsewhere the alert is logged. */
export async function defaultAlertSender(subject: string, body: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production' || process.env.AI_HEALTH_ALERTS === 'off') {
    console.error(`[ai-health] alert suppressed outside production: ${subject}\n${body}`)
    return
  }
  const { sendPlatformAlert } = await import('@controller/lib/provisioning/alerts')
  await sendPlatformAlert(subject, body, {
    kind: 'ai_health_alert',
    kicker: 'AI Platform Alert',
    footer: 'Automated AI health check (every 5 min).',
  })
}

/** Open/close the incident in Redis and alert only on the transitions. */
export async function recordAiHealth(result: AiHealthResult, send: AlertSender = defaultAlertSender): Promise<IncidentTransition> {
  const redis = getRedisClient()
  let open: Incident | null = null
  try {
    const raw = await redis.get(INCIDENT_KEY)
    open = raw ? (JSON.parse(raw) as Incident) : null
  } catch (e) {
    console.error('[ai-health] incident state read failed:', (e as Error)?.message || e)
  }
  const details = `Gateway: ${aiGatewayUrl()}\nDirect Ollama: ${ollamaDirectUrl() || '(not configured)'}`

  if (!result.ok) {
    if (open) return 'ongoing'
    const incident: Incident = { since: new Date().toISOString(), reasons: result.reasons }
    try {
      await redis.set(INCIDENT_KEY, JSON.stringify(incident), 'EX', INCIDENT_TTL_S)
    } catch (e) {
      console.error('[ai-health] incident state write failed:', (e as Error)?.message || e)
    }
    console.error(`[ai-health] AI DOWN: ${result.reasons.join(' | ')}`)
    await send(
      '[Jeffi] AI platform DOWN',
      `${result.reasons.map(r => `- ${r}`).join('\n')}\n\n${details}\n\n` +
        'Runbook: ai-platform/README.md ("Ollama addresses and health"). You will get one recovery notice; no repeats while this lasts.'
    )
    return 'opened'
  }

  if (!open) return 'healthy'
  try {
    await redis.del(INCIDENT_KEY)
  } catch (e) {
    console.error('[ai-health] incident state clear failed:', (e as Error)?.message || e)
  }
  const mins = Math.round((Date.now() - Date.parse(open.since)) / 60_000)
  console.error(`[ai-health] AI recovered after ~${mins} min`)
  await send(
    '[Jeffi] AI platform recovered',
    `AI health check passing again (gateway chat ${result.gateway.latencyMs} ms).\n` +
      `Down since ${open.since} (~${mins} min). Initial cause:\n${open.reasons.map(r => `- ${r}`).join('\n')}\n\n${details}`
  )
  return 'recovered'
}
