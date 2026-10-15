// Ordered set of Ollama base URLs (e.g. cni0 bridge, Tailscale, LAN). The first healthy one is
// active; re-probed periodically and on connection failure, and each request fails over to the
// next URL on a network error. Side-effect free until start(), so it is unit-testable.

export interface PoolStatus {
  ok: boolean
  active: string | null
  urls: string[]
  checkedAt: number | null
  reason?: string
}

export interface PoolOptions {
  probeTimeoutMs?: number
  /** Re-probe cadence; also the max age of a cached status. */
  probeIntervalMs?: number
  /** Minimum gap between probes triggered by traffic, so an outage is not hammered. */
  minReprobeMs?: number
  fetchImpl?: typeof fetch
  log?: (msg: string) => void
  now?: () => number
}

const NET_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED',
])

/** Connection-level failure (route/DNS/socket), as opposed to an HTTP error or our own generation timeout. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string } } | null
  if (!e || e.name === 'AbortError') return false
  if (e.code && NET_CODES.has(e.code)) return true
  if (e.cause?.code && NET_CODES.has(e.cause.code)) return true
  if (e.cause?.name === 'ConnectTimeoutError') return true
  return e.name === 'TypeError' && /fetch failed/i.test(String((e as Error).message))
}

function describe(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } }
  return e?.cause?.code || e?.cause?.message || e?.message || String(err)
}

export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OllamaUnavailableError'
  }
}

export class OllamaPool {
  readonly urls: string[]
  private activeUrl: string | null = null
  private checkedAt: number | null = null
  private reason: string | undefined
  private announced: string | null | undefined = undefined
  private inflight: Promise<string | null> | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly opts: Required<PoolOptions>

  constructor(urls: string[], opts: PoolOptions = {}) {
    if (urls.length === 0) throw new Error('OllamaPool needs at least one URL')
    this.urls = urls
    this.opts = {
      probeTimeoutMs: opts.probeTimeoutMs ?? 2_000,
      probeIntervalMs: opts.probeIntervalMs ?? 15_000,
      minReprobeMs: opts.minReprobeMs ?? 2_000,
      fetchImpl: opts.fetchImpl ?? ((...a) => fetch(...a)),
      // eslint-disable-next-line no-console
      log: opts.log ?? (m => console.log(`[ai-gateway] ${m}`)),
      now: opts.now ?? Date.now,
    }
  }

  start(): void {
    if (this.timer) return
    void this.probe()
    this.timer = setInterval(() => void this.probe(), this.opts.probeIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): PoolStatus {
    return { ok: !!this.activeUrl, active: this.activeUrl, urls: this.urls, checkedAt: this.checkedAt, reason: this.reason }
  }

  /** True only when a recent probe found every URL dead (lets handlers fail fast). */
  knownDown(): boolean {
    return !this.activeUrl && this.checkedAt !== null && this.opts.now() - this.checkedAt < this.opts.probeIntervalMs * 2
  }

  /** Cached status, re-probed when older than the probe interval. */
  async health(): Promise<PoolStatus> {
    if (this.checkedAt === null || this.opts.now() - this.checkedAt >= this.opts.probeIntervalMs) await this.probe()
    return this.status()
  }

  private async probeOne(url: string): Promise<string | null> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.opts.probeTimeoutMs)
    try {
      const res = await this.opts.fetchImpl(`${url}/api/tags`, { signal: ctrl.signal })
      return res.ok ? null : `HTTP ${res.status}`
    } catch (e) {
      return (e as Error)?.name === 'AbortError' ? `timeout ${this.opts.probeTimeoutMs}ms` : describe(e)
    } finally {
      clearTimeout(t)
    }
  }

  /** Probe in order and activate the first healthy URL. Concurrent callers share one probe. */
  probe(skip: ReadonlySet<string> = new Set()): Promise<string | null> {
    if (skip.size === 0 && this.inflight) return this.inflight
    const run = (async () => {
      const failures: string[] = []
      let found: string | null = null
      for (const url of this.urls) {
        if (skip.has(url)) continue
        const err = await this.probeOne(url)
        if (!err) { found = url; break }
        failures.push(`${url}: ${err}`)
      }
      this.setActive(found, found ? undefined : `no healthy Ollama (${failures.join('; ') || 'all URLs already failed'})`)
      return found
    })()
    if (skip.size === 0) {
      this.inflight = run
      void run.finally(() => { if (this.inflight === run) this.inflight = null })
    }
    return run
  }

  private setActive(url: string | null, reason?: string): void {
    this.activeUrl = url
    this.reason = reason
    this.checkedAt = this.opts.now()
    if (url === this.announced) return
    const prev = this.announced
    this.announced = url
    if (url) this.opts.log(`ollama active: ${url}${prev ? ` (was ${prev})` : prev === null ? ' (recovered)' : ''}`)
    else this.opts.log(`ollama UNREACHABLE: ${reason}`)
  }

  /** Active URL, probing when none is known (rate-limited while everything is down). */
  async resolve(): Promise<string> {
    if (this.activeUrl) return this.activeUrl
    const fresh = this.checkedAt !== null && this.opts.now() - this.checkedAt < this.opts.minReprobeMs
    const url = fresh ? null : await this.probe()
    if (!url) throw new OllamaUnavailableError(`Ollama is not reachable: ${this.reason ?? 'no healthy URL'}`)
    return url
  }

  /** Run fn against the active URL, failing over to the next healthy URL on a connection error. */
  async withOllama<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const tried = new Set<string>()
    let url = await this.resolve()
    for (;;) {
      tried.add(url)
      try {
        return await fn(url)
      } catch (err) {
        if (!isNetworkError(err)) throw err
        this.opts.log(`ollama request to ${url} failed (${describe(err)}); failing over`)
        if (this.activeUrl === url) this.activeUrl = null
        const next = await this.probe(tried)
        if (!next) throw new OllamaUnavailableError(`Ollama is not reachable: ${this.reason}`)
        url = next
      }
    }
  }
}
