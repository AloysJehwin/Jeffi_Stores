// Circuit breaker for the LLM service (the Razer box): Ollama serves text, vision and embed, SD serves image,
// PaddleOCR serves ocr. Each backend is probed on an interval and again right after a call fails at the transport
// level; after `failures` bad probes in a row its breaker opens and routing skips razer for that backend's
// capabilities (no long timeout per call), and the first good probe closes it. Side-effect free until start().

import type { RazerBackendHealth, RazerBackendName, RazerHealth } from '../../sdk/types'
import { isNetworkError, type PoolStatus } from './providers/ollama-pool'
import { ProviderError, type MediaProvider } from './providers/types'

/** null = healthy, else the reason. */
export type ProbeCheck = () => Promise<string | null>

export interface HealthSource {
  isOpen(): boolean
  status(): RazerBackendHealth
}

export interface ProbeOptions {
  configured?: boolean
  intervalMs?: number
  /** Failed probes in a row before the breaker opens. */
  failures?: number
  /** Re-probe cadence while open (recovery is noticed sooner). */
  openIntervalMs?: number
  /** Minimum gap between probes triggered by failed calls. */
  minReprobeMs?: number
  now?: () => number
  log?: (msg: string) => void
}

export class BackendProbe implements HealthSource {
  private ok = false
  private checkedAt: number | null = null
  private reason: string | undefined = 'not probed yet'
  private streak = 0
  private wasOpen = false
  private inflight: Promise<boolean> | null = null
  private timer: NodeJS.Timeout | null = null
  private lastTrigger = -Infinity
  private readonly opts: Required<ProbeOptions>

  constructor(readonly name: RazerBackendName | string, private readonly check: ProbeCheck, opts: ProbeOptions = {}) {
    const intervalMs = opts.intervalMs ?? 15_000
    this.opts = {
      configured: opts.configured ?? true,
      intervalMs,
      failures: Math.max(1, opts.failures ?? 2),
      openIntervalMs: opts.openIntervalMs ?? Math.min(intervalMs, 5_000),
      minReprobeMs: opts.minReprobeMs ?? 2_000,
      now: opts.now ?? Date.now,
      // eslint-disable-next-line no-console
      log: opts.log ?? (m => console.log(`[ai-gateway] ${m}`)),
    }
    if (!this.opts.configured) this.reason = 'not configured'
  }

  start(): void {
    if (this.timer || !this.opts.configured) return
    const tick = async () => {
      await this.probe()
      if (!this.timer) return
      this.timer = setTimeout(tick, this.isOpen() ? this.opts.openIntervalMs : this.opts.intervalMs)
      this.timer.unref?.()
    }
    this.timer = setTimeout(tick, 0)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Breaker open: the last `failures` probes all failed. Unknown (never probed) counts as closed. */
  isOpen(): boolean {
    return this.opts.configured && this.streak >= this.opts.failures
  }

  status(): RazerBackendHealth {
    return { configured: this.opts.configured, ok: this.ok, open: this.isOpen(), reason: this.reason, checkedAt: this.checkedAt }
  }

  /** One probe; concurrent callers share it. Resolves true when healthy. */
  probe(): Promise<boolean> {
    if (!this.opts.configured) return Promise.resolve(false)
    if (this.inflight) return this.inflight
    const run = (async () => {
      let reason: string | null
      try { reason = await this.check() } catch (e) { reason = describe(e) }
      this.settle(reason)
      return reason === null
    })()
    this.inflight = run
    void run.finally(() => { if (this.inflight === run) this.inflight = null })
    return run
  }

  /** A call failed at the transport level: re-probe now (rate-limited) instead of waiting for the next tick. */
  recordFailure(): void {
    const now = this.opts.now()
    if (now - this.lastTrigger < this.opts.minReprobeMs) return
    this.lastTrigger = now
    void this.probe()
  }

  /** Run a call against this backend, re-probing when it fails like an outage. */
  async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (isOutage(err)) this.recordFailure()
      throw err
    }
  }

  private settle(reason: string | null): void {
    const firstProbe = this.checkedAt === null
    const wasOk = this.ok
    this.ok = reason === null
    this.reason = reason ?? undefined
    this.checkedAt = this.opts.now()
    this.streak = this.ok ? 0 : this.streak + 1
    const open = this.isOpen()
    if (open && !this.wasOpen) this.opts.log(`${this.name} UNAVAILABLE: ${reason} (breaker open, routing skips razer)`)
    else if (!open && this.wasOpen) this.opts.log(`${this.name} recovered (breaker closed)`)
    else if (firstProbe || wasOk !== this.ok) this.opts.log(`${this.name} ${this.ok ? 'ready' : `probe failed: ${reason}`}`)
    this.wasOpen = open
  }
}

/** Transport-level failures and gateway-style statuses mean "down"; a 4xx or a 500 for one bad input does not. */
export function isOutage(err: unknown): boolean {
  if (isNetworkError(err)) return true
  const e = err as { name?: string; status?: number; message?: string } | null
  if (!e) return false
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  if (err instanceof ProviderError) {
    if (e.status === undefined) return true
    return e.status >= 502 && e.status <= 504
  }
  return /fetch failed|aborted|timed out|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(e.message ?? '')
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'timeout'
  return e?.cause?.code || e?.cause?.message || e?.message || String(err)
}

/** GET a health URL: 2xx is healthy. */
export function httpCheck(url: string, timeoutMs: number, fetchImpl: typeof fetch = (...a) => fetch(...a)): ProbeCheck {
  return async () => {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      return res.ok ? null : `HTTP ${res.status}`
    } catch (e) {
      const name = (e as Error)?.name
      return name === 'TimeoutError' || name === 'AbortError' ? `timeout ${timeoutMs}ms` : describe(e)
    }
  }
}

/** The Ollama pool already probes its URLs; its "known down" is the breaker. */
export function poolSource(pool: { status(): PoolStatus; knownDown(): boolean }): HealthSource {
  return {
    isOpen: () => pool.knownDown(),
    status: () => {
      const s = pool.status()
      return { configured: true, ok: s.ok, open: pool.knownDown(), reason: s.reason, checkedAt: s.checkedAt }
    },
  }
}

export type RazerCapability = 'text' | 'vision' | 'embed' | 'image' | 'ocr'
export const RAZER_BACKEND: Record<RazerCapability, RazerBackendName> = {
  text: 'ollama', vision: 'ollama', embed: 'ollama', image: 'sd', ocr: 'paddleocr',
}

export class RazerHealthMonitor {
  constructor(readonly sources: Record<RazerBackendName, HealthSource>) {}

  /** False while the backend behind this capability has its breaker open. */
  up(cap: RazerCapability): boolean {
    return !this.sources[RAZER_BACKEND[cap]].isOpen()
  }

  report(): RazerHealth {
    return { ollama: this.sources.ollama.status(), sd: this.sources.sd.status(), paddleocr: this.sources.paddleocr.status() }
  }
}

/** The razer image provider behind its breaker: a transport failure triggers a re-probe. */
export function guardedMedia(p: MediaProvider, probe: BackendProbe): MediaProvider {
  return {
    name: p.name,
    configured: () => p.configured(),
    ...(p.generateImage ? { generateImage: req => probe.guard(() => p.generateImage!(req)) } : {}),
  }
}
