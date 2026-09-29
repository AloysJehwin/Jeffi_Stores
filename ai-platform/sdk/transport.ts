import { AiClientError } from './types'
import type { SdkConfig } from './config'

// The gateway holds the HTTP connection open until the queued job completes and
// returns the final JSON, so the SDK stays synchronous (await) while durability
// (queue + retries) lives entirely server-side. The caller never manages jobIds.

export async function post<T>(config: SdkConfig, path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), config.requestTimeoutMs)
  try {
    const res = await fetch(`${config.gatewayUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new AiClientError(`AI gateway HTTP ${res.status}: ${detail}`, 'gateway')
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof AiClientError) throw err
    throw new AiClientError(err instanceof Error ? err.message : 'AI gateway request failed', 'gateway', err)
  } finally {
    clearTimeout(t)
  }
}

export async function getHealth(config: SdkConfig): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), config.healthTimeoutMs)
  try {
    const res = await fetch(`${config.gatewayUrl}/healthz`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}
