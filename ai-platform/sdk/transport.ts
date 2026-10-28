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

export async function get<T>(config: SdkConfig, path: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), config.requestTimeoutMs)
  try {
    const res = await fetch(`${config.gatewayUrl}${path}`, { signal: ctrl.signal })
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

/** POST and read an NDJSON stream, one parsed object per line. */
export async function* postNdjson<T>(config: SdkConfig, path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), config.requestTimeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${config.gatewayUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new AiClientError(`AI gateway HTTP ${res.status}: ${detail}`, 'gateway')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) yield JSON.parse(line) as T
      }
      if (done) break
    }
    if (buf.trim()) yield JSON.parse(buf) as T
  } catch (err) {
    if (err instanceof AiClientError) throw err
    throw new AiClientError(err instanceof Error ? err.message : 'AI gateway request failed', 'gateway', err)
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}
